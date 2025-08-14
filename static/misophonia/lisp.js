const TokType = {
    // (
    PAREN_OPEN: 'PAREN_OPEN',
    // )
    PAREN_CLOSE: 'PAREN_CLOSE',
    // '
    QUOTE: 'QUOTE',
    // `
    QUASI_QUOTE: 'QUASI_QUOTE',
    // , 
    UNQUOTE: 'UNQUOTE',
    // @        e.g. `(+ 1 2 ,@(cons 3 '(4))) => '(+ 1 2 3 4)
    AT_SIGN: 'AT_SIGN',
    ATOM: 'ATOM',
    // should not happen hopefully
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
            case '(':
                return TokType.PAREN_OPEN;
            case ')':
                return TokType.PAREN_CLOSE;
            case '\'':
                return TokType.QUOTE;
            case '`':
                return TokType.QUASI_QUOTE;
            case ',':
                return TokType.UNQUOTE;
            case '@':
                return TokType.AT_SIGN
        }

        return TokType.ATOM;
    }
}

// special chars ()'`,@
function tokenize(str) {
    return (str
        // strip CL-style comments
        .replace(/;.*$/gm, '')
        // grab parens, or atoms
        .match(/[^\s()'`,@]+|[()'`,@]/g) || []
    ).map(c => new Token(c));
}

const ASTType = {
    ATOM: 'ATOM', // e.g. foo
    LIST: 'LIST',
    QUOTE: 'QUOTE',
    QUASI_QUOTE: 'QUASI_QUOTE',
    UNQUOTE: 'UNQUOTE',
}

class ASTNode {
    /** @param {ASTType} type */
    constructor(val, type) { this.val = val; this.type = type; }

    static newAtom(s) { return new ASTNode(s, ASTType.ATOM); }

    /**
     * @param {[ASTNode]} asts
     * @returns {ASTNode}
     */
    static fromList(asts) { return new ASTNode(asts, ASTType.LIST); }
}

/**
 * @param {[Token]} tokens
 * @returns {{node: ASTNode, rest: [Token], err: any}}
 */
function parseSexp(tokens) {
    const ts = tokens.slice();
    const tok = ts[0];
    let rest = ts.slice(1);

    let node = null;
    let err = null;
    let o
    switch (tok?.type) {
        case TokType.PAREN_OPEN:
            // parse list
            let exprs = [];
            o = parseSexp(rest);
            while (o.rest?.length && o.rest[0].type !== TokType.PAREN_CLOSE) {
                // parse subexpr
                exprs.push(o.node);
                o = parseSexp(o.rest);
            }
            exprs.push(o.node);
            if (o.err) err = "( " + o.err + " )";
            else if (exprs.length < 1) err = "evaluating empty list";
            else if (o.rest[0].type !== TokType.PAREN_CLOSE) err = "list ended unexpectedly";
            else node = ASTNode.fromList(exprs);
            rest = o.rest.slice(1);
            break;
        case TokType.PAREN_CLOSE:
            err = "paren_close not acceptable here";
        case TokType.QUOTE:
            // parse quoted expr
            o = parseSexp(rest);
            if (o.err) err = "'" + o.err;
            rest = o.rest;
            node = new ASTNode(o.node, ASTType.QUOTE);
            break;
        case TokType.QUASI_QUOTE:
            // parse quasi-quoted expr
            o = parseSexp(rest);
            if (o.err) err = "'" + o.err;
            rest = o.rest;
            node = new ASTNode(o.node, ASTType.QUASI_QUOTE);
            break;
        case TokType.UNQUOTE:
            // ,expr
            o = parseSexp(rest);
            if (o.err) err = "'" + o.err;
            rest = o.rest;
            node = new ASTNode(o.node, ASTType.UNQUOTE);
            break;
        case TokType.ATOM:
            node = ASTNode.newAtom(tok.lit);
            break;
    }

    return { node: node, rest: rest, err: err };
}

/**
 * @param {[Token]} tokens
 * @returns {[ASTNode]}
 */
function parse(tokens) {
    let o = parseSexp(tokens);
    let nodes = [o.node];
    while (o.rest?.length > 0 && !o.err) {
        o = parseSexp(o.rest);
        nodes.push(o.node);
    }
    if (o.err) console.warn('error parsing', o.err);
    return nodes;
}

const LispType = {
    NUMBER: "NUMBER",
    LIST: "LIST",
    KEYWORD: "KEYWORD",
    SYMBOL: "SYMBOL",
}

class LispVal { constructor(val, type, lit = undefined) { this.type = type; this.val = val; this.lit = lit; } }

/**
 * @param {ASTNode} ast
 */
function evaluateAtom(ast) {
    if (ast.type !== ASTType.ATOM) console.log("evaluating non-atom in atom function");

    const n = Number.parseFloat(ast.val);
    if (Number.isFinite(n)) return new LispVal(n, LispType.NUMBER, ast.val);

    const s = ast.val;
    if (s[0] === ":") // keyword
        return new LispVal(s, LispType.KEYWORD, s);

    return new LispVal(s, LispType.SYMBOL, s);
}

let defaultEnv = {
    fns: {
        "+": {
            call: (args, env) => {
                let acc = 0;
                for (const a of args) {
                    acc += a.val;
                }
                return new LispVal(acc, LispType.NUMBER);
            }
        }
    },
    getFn: (name) => defaultEnv.fns[name],
};

/**
 * @param {ASTNode} ast
 */
function evaluate(ast, env) {
    switch (ast.type) {
        case ASTType.ATOM:
            // evaluate to value representation
            return evaluateAtom(ast);
            break;
        case ASTType.LIST:
            // evaluate to funcall
            if (ast.val.length < 1) console.warn("Not enough args to funcall");

            // evaluate sub-lists
            let vals = [];
            for (const v of ast.val) {
                let r = evaluate(v, env);
                vals.push(r);
            }
            const fnName = vals[0];
            const args = vals.slice(1);
            // get function from function table
            const fn = env.getFn(fnName.val);
            // pass their vals into the function
            return fn.call(args, env);
            break;
        case ASTType.QUOTE:
        case ASTType.QUASI_QUOTE:
    }
}

function evalStr(s) {
    return evaluate(parseSexp(tokenize(s)).node);
}

// function parse(str) {
//     const tokens = tokenize(str);
//     const expr = parseSexp(tokens);
//     if (tokens.length) console.warn("Extra tokens after first expr", tokens);
//     return expr;
// }
// function evaluate(tree) {
//     // Expect: [ 'shader', shaderName, ...clauses ]
//     if (tree[0] !== 'shader') throw new Error("DSL must start with (shader …)");
//     const cfg = { name: tree[1], uniforms: {}, textures: [] };
//     for (let i = 2; i < tree.length; i++) {
//         const clause = tree[i];
//         const [kw, ...rest] = clause;
//         switch (kw) {
//             case 'uniform':
//                 // [ 'uniform', name, value ]
//                 const val = rest[1];
//                 cfg.uniforms[rest[0]] = (val === 'true' || val === 'false') ? (val === 'true') : val;
//                 break;
//             case 'texture':
//                 // TODO: parse (file|shader arg) to an object which returns a texture handle
//                 // [ 'texture', slot, ['file'|'shader', arg] ]
//                 cfg.textures.push({ slot: rest[0], [rest[1][0]]: rest[1][1] });
//                 break;
//             default:
//                 console.warn("Unknown DSL clause", kw);
//         }
//     }
//     return cfg;
// }

// export {
//     parse, evaluate
// };

/*
(let* ((shad-0 (shader "color-invert" :texture-0 (select-shader-tab 1)))
       (shad-1 (shader "color-invert" :texture-0 shad-0))
       (main-shader (shader "demo-moire"
                            :texture-0 shad-0
                            :texture-1 shad-1)))
  main-shader							; render main moire shader
  )


(shader "demo-moire"
(uniform u_mode 2)
(uniform u_colInv1 false)
(uniform u_colInv0 true)
(texture 0 shader 2)
(texture 1 shader 1)
)
*/
