// ---------- TOKENIZER --------------------------------------------------------

const TokType = {
    PAREN_OPEN: 'PAREN_OPEN',
    PAREN_CLOSE: 'PAREN_CLOSE',
    QUOTE: 'QUOTE',            // '
    QUASI_QUOTE: 'QUASI_QUOTE',// `
    UNQUOTE: 'UNQUOTE',        // ,
    UNQUOTE_SPLICING: 'UNQUOTE_SPLICING', // ,@
    ATOM: 'ATOM',
    UNKNOWN: 'UNKNOWN',
};

/**
 * @class Token
 * @member {TokType} type
 */
class Token {
    constructor(lit) {
        /** @type {TokType} type */
        this.type = Token.inferType(lit);
        this.lit = lit;
    }

    /**
     * @param {String} lit
     * @returns {TokType}
     */
    static inferType(lit) {
        switch (lit) {
            case '(': return TokType.PAREN_OPEN;
            case ')': return TokType.PAREN_CLOSE;
            case '\'': return TokType.QUOTE;
            case '`': return TokType.QUASI_QUOTE;
            case ',': return TokType.UNQUOTE;
            case ',@': return TokType.UNQUOTE_SPLICING;
        }
        return TokType.ATOM;
    }
}

// special chars ()'`, @ and string literals "..."
function tokenize(str) {
    const re =
        /"([^"\\]|\\.)*"|[^\s()'`,@]+|,@|[()'`,@]/g; // order matters: ",@" before single chars
    return (str
        .replace(/;.*$/gm, '')            // strip CL-style comments
        .match(re) || []
    ).map(c => new Token(c));
}

// ---------- AST --------------------------------------------------------------

const ASTType = {
    ATOM: 'ATOM', // e.g. foo or "bar"
    LIST: 'LIST',
    // QUOTE: 'QUOTE',
    // QUASI_QUOTE: 'QUASI_QUOTE',
    // UNQUOTE: 'UNQUOTE',
    // UNQUOTE_SPLICING: 'UNQUOTE_SPLICING',
}

class ASTNode {
    /** @param {ASTType} type */
    constructor(val, type) { this.val = val; this.type = type; }

    static newAtom(s) { return new ASTNode(s, ASTType.ATOM); }
    static fromList(asts) { return new ASTNode(asts, ASTType.LIST); }
}
function sym(name) { return ASTNode.newAtom(name); }

/**
 * Parse a single S-expression starting at tokens[0]
 * @param {[Token]} tokens
 * @returns {{node: ASTNode|null, rest: [Token], err: string|null}}
 */
function parseSexp(tokens) {
    if (!tokens.length) return { node: null, rest: [], err: 'unexpected EOF' };

    const [tok, ...rest0] = tokens;

    // Wrap a following expression as (name <expr>)
    const parsePrefixed = (name, glyph) => {
        const o = parseSexp(rest0);
        if (o.err) return { node: null, rest: o.rest, err: glyph + ' ' + o.err };
        return { node: ASTNode.fromList([sym(name), o.node]), rest: o.rest, err: null };
    };

    switch (tok.type) {
        case TokType.PAREN_OPEN: {
            let rest = rest0;
            const items = [];
            while (true) {
                if (!rest.length) return { node: null, rest, err: 'list ended unexpectedly' };
                if (rest[0].type === TokType.PAREN_CLOSE) {
                    return { node: ASTNode.fromList(items), rest: rest.slice(1), err: null };
                }
                const o = parseSexp(rest);
                if (o.err) return { node: null, rest: o.rest, err: '( ' + o.err + ' )' };
                items.push(o.node);
                rest = o.rest;
            }
        }

        case TokType.PAREN_CLOSE:
            return { node: null, rest: rest0, err: 'unexpected )' };

        case TokType.QUOTE: return parsePrefixed('quote', "'");
        case TokType.QUASI_QUOTE: return parsePrefixed('quasiquote', '`');
        case TokType.UNQUOTE: return parsePrefixed('unquote', ',');
        case TokType.UNQUOTE_SPLICING: return parsePrefixed('unquote-splicing', ',@');

        case TokType.ATOM:
            return { node: ASTNode.newAtom(tok.lit), rest: rest0, err: null };

        default:
            return { node: null, rest: rest0, err: 'unknown token' };
    }
}

/**
 * Parse all top-level forms
 * @param {[Token]} tokens
 * @returns {{nodes:[ASTNode], err:string|null}}
 */
function parse(tokens) {
    let rest = tokens.slice();
    const nodes = [];
    while (rest.length) {
        const o = parseSexp(rest);
        if (o.err) return { nodes, err: o.err };
        nodes.push(o.node);
        rest = o.rest;
    }
    return { nodes, err: null };
}

// ---------- VALUES / ENV -----------------------------------------------------

const LispType = {
    NUMBER: 'NUMBER',
    LIST: 'LIST',
    KEYWORD: 'KEYWORD',
    SYMBOL: 'SYMBOL',
    STRING: 'STRING',
    BOOLEAN: 'BOOLEAN',
    NIL: 'NIL',
    // TODO: support external "JS object" type
    JSOBJECT: 'JSOBJECT',
}

class LispVal {
    constructor(val, type, lit = undefined) { this.type = type; this.val = val; this.lit = lit; }
}

const NIL = new LispVal(null, LispType.NIL, 'nil');

// pretty-printer
function show(v) {
    switch (v?.type) {
        case LispType.NIL: return 'nil';
        case LispType.NUMBER: return String(v.val);
        case LispType.STRING: return JSON.stringify(v.val);
        case LispType.KEYWORD: return v.val;
        case LispType.SYMBOL: return '\'' + v.val;
        case LispType.BOOLEAN: return v.val ? 't' : 'nil';
        case LispType.LIST: return '(' + v.val.map(show).join(' ') + ')';
        default: return String(v?.val ?? v);
    }
}

const list = (...xs) => xs.length ? new LispVal(xs, LispType.LIST) : NIL;

function makeEnv(parent = null) {
    const env = {
        parent,
        vars: Object.create(null),
        fns: Object.create(null),
        specials: Object.create(null),

        getVar(name) {
            if (name in this.vars) return this.vars[name];
            if (this.parent) return this.parent.getVar(name);
            return undefined;
        },
        setVar(name, val) { this.vars[name] = val; return val; },

        getFn(name) {
            if (name in this.fns) return this.fns[name];
            if (this.parent) return this.parent.getFn(name);
            return undefined;
        },
        getSpecial(name) {
            if (name in this.specials) return this.specials[name];
            if (this.parent) return this.parent.getSpecial(name);
            return undefined;
        },
    };
    return env;
}

const globalEnv = makeEnv();

// ---------- READER/EVAL HELPERS ---------------------------------------------

/** Evaluate an atom into a LispVal (numbers, strings, booleans, keywords, symbols). */
function evaluateAtom(ast, env) {
    if (ast.type !== ASTType.ATOM) throw new Error("evaluateAtom called on non-atom");

    const s = ast.val;

    // string literal?
    if (s[0] === '"' && s[s.length - 1] === '"') {
        const unescaped = JSON.parse(s); // safe due to tokenizer
        return new LispVal(unescaped, LispType.STRING, s);
    }

    // number?
    const n = Number.parseFloat(s);
    if (!Number.isNaN(n) && isFinite(n) && String(n) === s.replace(/^(\+)?/, '')) {
        return new LispVal(n, LispType.NUMBER, s);
    }

    // booleans
    if (s === 'true' || s === '#t') return new LispVal(true, LispType.BOOLEAN, s);
    if (s === 'false' || s === '#f') return new LispVal(false, LispType.BOOLEAN, s);

    // keyword
    if (s[0] === ':') return new LispVal(s, LispType.KEYWORD, s);

    // symbol: if bound => value, else keep as SYMBOL
    const bound = env.getVar(s);
    if (bound !== undefined) return bound;
    return new LispVal(s, LispType.SYMBOL, s);
}

// QUOTE: turn AST into value without evaluation
function quoteAST(ast) {
    switch (ast.type) {
        case ASTType.ATOM: {
            const s = ast.val;
            if (s[0] === '"' && s[s.length - 1] === '"') return new LispVal(JSON.parse(s), LispType.STRING, s);
            const n = Number.parseFloat(s);
            if (!Number.isNaN(n) && isFinite(n) && String(n) === s.replace(/^(\+)?/, '')) return new LispVal(n, LispType.NUMBER, s);
            if (s === 'true' || s === '#t') return new LispVal(true, LispType.BOOLEAN, s);
            if (s === 'false' || s === '#f') return new LispVal(false, LispType.BOOLEAN, s);
            if (s[0] === ':') return new LispVal(s, LispType.KEYWORD, s);
            return new LispVal(s, LispType.SYMBOL, s);
        }
        case ASTType.LIST:
            return ast.val.length ? new LispVal(ast.val.map(quoteAST), LispType.LIST) : NIL;

        default:
            console.log(ast);
            throw new Error('unknown AST in quote');
    }
}

const isFunctionVal = (v) => v && v.type === LispType.JSOBJECT && v.val && v.val._fnTag === 'CL-FUNCTION';

// ---------- EVALUATOR --------------------------------------------------------


/**
 * @param {ASTNode} ast
 * @param {*} env
 * @returns {LispVal}
 */
function evaluate(ast, env = globalEnv) {
    switch (ast.type) {
        case ASTType.ATOM:
            return evaluateAtom(ast, env);

        case ASTType.LIST: {
            if (ast.val.length === 0) return NIL;

            const headAst = ast.val[0];

            // Special forms by symbol at AST level
            if (headAst.type === ASTType.ATOM) {
                const sp = env.getSpecial(headAst.val);
                if (sp) return sp(ast.val.slice(1), env);
            }

            // Evaluate operator *only once*, then decide how to call
            const opVal = evaluate(headAst, env);
            const argVals = ast.val.slice(1).map(n => evaluate(n, env));

            if (opVal.type === LispType.SYMBOL) {
                const fn = env.getFn(opVal.val);
                if (!fn) throw new Error(`unknown function: ${opVal.val}`);
                return fn.call(argVals, env);
            }

            if (isFunctionVal(opVal)) {
                // Apply lambda
                const fn = opVal.val;
                const callEnv = makeEnv(fn.closureEnv);
                if (fn.params.length !== argVals.length)
                    throw new Error(`arity mismatch: expected ${fn.params.length}, got ${argVals.length}`);
                for (let i = 0; i < fn.params.length; i++) callEnv.setVar(fn.params[i], argVals[i]);
                let last = NIL;
                for (const form of fn.body) last = evaluate(form, callEnv);
                return last;
            }

            throw new Error('first position must be a function (symbol or lambda)');
        }

        default:
            throw new Error('unknown AST node type');
    }
}

// ---------- CORE ENV ---------------------------------------------------------


// demo JS interface
/**
 * @param {[LispVal]} args 
 */
function loadShaderBuffer(args) {
    // expected form:
    //   string (name of shader to load)
    //   list containing uniform:value pairs
    //   list containing textures
}

function expectArgs(args, min = undefined, max = undefined) {
    if (args.length < min || args.length > max) throw new Error("incorrect length");
}

// https://stackoverflow.com/questions/4589366/the-most-minimal-lisp
// taking inspiration from https://paulgraham.com/lispcode.html
// we need only define quote, atom, eq, cons, car, cdr, and cond
Object.assign(globalEnv.fns, {});

// Special forms (operate on AST, not values)
Object.assign(globalEnv.specials, {
    'quote': (args, env) => {
        expectArgs(1, args);
        return quoteAST(args[0]);
    },
});

Object.assign(globalEnv.vars, {
    'nil': new LispVal(null, LispType.NIL, 'nil'),
    't': new LispVal('t', new LispVal(true, LispType.BOOLEAN, 't')),
});

// ---------- PUBLIC API -------------------------------------------------------

function evalStr(s, env = globalEnv) {
    const { nodes, err } = parse(tokenize(s));
    if (err) throw new Error('parse error: ' + err);
    let last = NIL;
    for (const n of nodes) last = evaluate(n, env);
    return last;
}

// ---------- EXAMPLES ---------------------------------------------------------
// console.log(show(evalStr("(+ 1 2 3)")));                 // 6
// console.log(show(evalStr("'(1 2 3)")));                  // (1 2 3)
// console.log(show(evalStr("`(a ,(+ 1 2) ,@(list 4 5))"))); // (a 3 4 5)
// console.log(show(evalStr(`(define foo "color-invert")`)));// "color-invert"
// console.log(show(evalStr("(if true foo \"nope\")")));     // "color-invert"
// console.log(show(evalStr("(car '(10 20 30))")));          // 10
