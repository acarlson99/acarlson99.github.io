// knuth dancing links adapted from
// https://www.cs.mcgill.ca/~aassaf9/python/algorithm_x.html

// TODO: make `score` function
// a.map(e => e.map(s => s.length).reduce((a,b) => a+b)) 

let cardObs = {
    cards: ["A", 2, "I", 2, "L", 3, "CL", 10, "A", 2, "I", 2, "J", 13, "D", 5, "U", 4, "H", 7, "I", 2, "A", 2, "P", 6, "M", 5, "Y", 4, "N", 5],
    date: "2019-07-13",
    words: ["aa", "aah", "aal", "aalii", "ad", "adman", "adynamia", "ah", "aha", "ahi", "ahu", "ai", "aia", "aid", "aidman", "ail", "aim", "ain", "al", "ala", "alan", "aland", "alday", "aliya", "aliyah", "alma", "almah", "alman", "almud", "alp", "alpha", "alpia", "alum", "alumin", "alumina", "alumna", "alumni", "am", "ama", "amah", "amain", "ami", "amia", "amid", "amidin", "amin", "amnia", "amp", "amply", "ampul", "amu", "amyl", "an", "ana", "anal", "and", "ani", "anil", "anima", "animal", "animi", "any", "apaid", "aphid", "aphidian", "apian", "apimania", "aua", "auld", "ay", "ayah", "ayin", "ayu",
        "clad", "claim", "clam", "clamp", "clan", "clap", "clay", "claypan", "clinal", "clip", "clum", "clump", "clumpy", "cly", "da", "dah", "dahl", "dahlia", "daily", "dal", "dam", "daman", "damn", "damp", "damply", "dan", "dap", "daphnia", "daun", "dauphin", "day", "dhal", "dial", "diamin", "dicliny", "dim", "dimly", "dimply", "din", "dip", "djin", "dual", "duh", "dui", "dulia", "duly", "duma", "dumal", "dump", "dumpily", "dumpy", "dun", "dunam", "dup",
        "ha", "had", "hadal", "hadj", "hadji", "hail", "haily", "haj", "haji", "halid", "halm", "halma", "ham", "hamal", "hamaul", "hamuli", "han", "hand", "handily", "handy", "hap", "haply", "haul", "haulm", "haulmy", "hay", "hi", "hid", "hila", "hili", "hilum", "him", "hin", "hind", "hip", "hiply", "hm", "hui", "hula", "huly", "hum", "human", "humanly", "humid", "humidly", "hump", "humpy", "hun", "hup", "hyalin", "hyla", "hymn", "hymnal", "hyp",
        "id", "idly", "idyl", "ilia", "iliad", "ilium", "iman", "imid", "imp", "impala", "impi", "imply", "in", "inclip", "india", "indium", "inhaul", "inia", "inlaid", "inlay", "inly", "jail", "jalap", "jalapin", "jam", "jap", "japan", "jaup", "jay", "jihad", "jiminy", "jimp", "jimply", "jimpy", "jin", "jud", "jump", "jumpily", "jumpy", "jun",
        "la", "lad", "ladanum", "lady", "lah", "laid", "lain", "lam", "lama", "lamia", "lamina", "lamp", "lampad", "lanai", "land", "landau", "lap", "lapin", "lauan", "laud", "lay", "layman", "layup", "li", "liana", "lid", "lim", "lima", "liman", "limina", "limn", "limp", "limpa", "limpid", "limy", "lin", "lindy", "linum", "liny", "lip", "lipa", "lipid", "lipin", "lud", "lum", "luma", "lumina", "lump", "lumpy", "luna", "luny", "lupin", "lyam", "lym", "lymph", "lyn",
        "ma", "maa", "mad", "madly", "maha", "maid", "mail", "main", "mainly", "mal", "mala", "malady", "malihini", "man", "mana", "mandala", "mania", "manila", "manly", "manual", "many", "map", "maud", "maudlin", "maul", "maun", "maund", "maundy", "may", "maya", "mayan", "mayhap", "mi", "miaul", "mid", "mida", "midi", "mil", "miladi", "milady", "mild", "milia", "milpa", "min", "mina", "mind", "mini", "miny", "mna", "mu", "mud", "muhly", "mun", "muni", "my", "myna", "mynah",
        "na", "na", "nad", "nada", "nah", "nah", "naiad", "naiad", "nail", "nail", "nam", "nap", "nap", "napa", "napalm", "napu", "nauplii", "nay", "nay", "nid", "nidal", "nidi", "nidi", "nihil", "nihil", "nil", "nil", "nim", "nim", "nip", "nip", "nipa", "nu", "nu", "nyala", "nyala", "nymph", "nymph", "nympha", "nymphal",
        "pa", "pad", "padi", "pah", "pahi", "paid", "pail", "pain", "pajama", "pal", "paladin", "pali", "palm", "palmy", "paly", "pam", "pan", "panada", "panama", "panda", "pandy", "pau", "paulin", "paum", "pay", "payn", "paynim", "ph", "phi", "phial", "phyla", "phylum", "pi", "pia", "pial", "pian", "pilau", "pili", "pily", "pima", "pin", "pina", "piny", "piu", "plaid", "plain", "plan", "play", "playa", "plim", "plu", "plum", "plumy", "ply", "pud", "puh", "puja", "pujah", "pul", "pula", "puli", "puma", "pumy", "pun", "puna", "punily", "punji", "puny", "puy", "pya", "pyin", "pyla",
        "udal", "uh", "uhlan", "ulama", "ulan", "ulna", "ulnad", "um", "ump", "un", "unai", "unclad", "unclamp", "undy", "unhip", "uni", "unlaid", "unlay", "unpaid", "up", "upland", "ya", "yad", "yah", "yalah", "yald", "yam", "yamun", "yap", "yaud", "yauld", "yaulp", "yaup", "yclad", "yi", "yid", "yin", "yip", "yu", "yuan", "yulan", "yum", "yup"]
};

function convertCardObs(cardObs) {
    let namedTargets = {};
    for (let i = 0; i < cardObs.cards.length; i++) {
        const c = cardObs.cards[i];
        if (i % 2 == 1) continue;

        if (!namedTargets[c]) namedTargets[c] = 0;
        namedTargets[c] += 1;
    }
    // TODO: loop words, create array of `cols.indexof(letter)` for each word, and figure out 2-letter cols i guess
    console.log(namedTargets);
    let xs = Object.keys(namedTargets).sort((a, b) => b.length - a.length);
    let targets = {};
    for (let i = 0; i < xs.length; i++) {
        let x = xs[i];
        targets[i + 1] = namedTargets[x];
    }
    console.log(xs);

    function removeSubstr(s, needle) {
        if (!needle) console.warn("no set needle");
        let i = s.indexOf(needle);
        if (i < 0) return s;
        return s.slice(0, i) + s.slice(i + needle.length);
    }

    // let X = {}; // column names
    let amounts = {};
    // targets = {};
    let Y = {};
    for (let word of cardObs.words) {
        word = word.toUpperCase()
        let s = word;
        let letterCounts = {};
        let arr = [];
        for (let i_ = 0; i_ < xs.length; i_++) {
            // for (let x of xs) {
            let x = xs[i_];
            let i = i_ + 1;
            while (true) {
                let s2 = removeSubstr(s, x);
                if (s2 == s) break;

                s = s2;
                if (!letterCounts[i]) letterCounts[i] = 0;
                letterCounts[i] += 1;

                if (!Y[word]) Y[word] = new Set();
                Y[word].add(i);
            }
            if (letterCounts[x]) arr.push(i);
            // else arr.push(0);
        }
        amounts[word] = letterCounts;
    }
    return {
        x: new Set(Object.keys(targets).map(Number)),
        y: Y,
        targets: targets,
        amounts: amounts,
    };
}

// TODO: save (in URL) and auto-load labels for X
let X = new Set([1, 2, 3, 4, 5, 6, 7]);
// this specifies how many tiles should occupy a column in `X`
let targets = {
    1: 1,
    2: 1,
    3: 2,
    4: 1,
    5: 1,
    6: 2,
    7: 1,
};
let amounts = {
    'A': {
        2: 1,
        3: 1,
        4: 1,
    },
    'B': {
        1: 1,
        2: 1,
        4: 1,
        5: 1,
    },
    'C': {
        1: 1,
        5: 1,
    },
    'D': {
        1: 1,
        2: 1,
        3: 1,
        4: 1,
    },
    'E': {
        3: 2,
        6: 1,
    },
    'F': {
        // 6: 2,
        6: 1,
        7: 1,
    },
}
let Y = {
    'A': new Set([2, 3, 4]),
    'B': new Set([1, 2, 4, 5]),
    'C': new Set([1, 5]),
    'D': new Set([1, 2, 3, 4]),
    'E': new Set([3, 6]),
    'F': new Set([6, 7]),
};
// {
//     'A': [1, 4, 7],
//     'B': [1, 4],
//     'C': [4, 5, 7],
//     'D': [3, 5, 6],
//     'E': [2, 3, 6, 7],
//     'F': [2, 7]
// };
// X = new Set([1, 2, 3, 4, 5]);
// Y = {
//     'A': [2, 3, 4],
//     'B': [1, 2, 4, 5],
//     'C': [1, 5],
//     'D': [1, 2, 3, 4],
//     'E': [3],
// };

{
    let o = convertCardObs(cardObs);
    X = o.x;
    Y = o.y;
    amounts = o.amounts;
    targets = o.targets;
}

let strState = () => JSON.stringify(X) + JSON.stringify(Y) + JSON.stringify(targets);

var cbDel = function () { };
var cbAdd = function () { };

function gothing(X, Y, ts, amts) {
    targets = ts;
    amounts = amts;
    for (let j of X) {
        if (!targets[j]) targets[j] = 1;
    }
    X = [...X].reduce((acc, j) => {
        acc[j] = new Set(Object.keys(Y).filter(i => Y[i].has(j)));
        return acc;
    }, {});

    X = Object.keys(X).reduce((acc, j) => {
        acc[j] = new Set();
        return acc;
    }, {});

    for (let i in Y) {
        for (let j of Y[i]) {
            X[j].add(i);
        }
    }
    for (let [k, v] of Object.entries(Y)) {
        if (!amounts[k]) amounts[k] = {};
        for (let i of v) {
            if (!amounts[k][i]) amounts[k][i] = 1;
        }
    }
    console.log(X, Y)
    console.log(amounts)

    let solutions = solve(X, Y);
    let agg = [];
    for (let solution of solutions) {
        console.log('SOL:', solution);
        agg.push(solution);
    }
    return agg;
}

function* solve(X, Y, solution) {
    if (!solution) {
        solution = [];
    }
    if (Object.keys(X).length === 0) {
        yield solution.slice();
    } else {
        // console.log(X)
        // let c = Math.min(...Object.keys(X).map(k => X[k].size));
        let j = 0;
        let kvs = Object.keys(X)
        for (let i = 1; i < kvs.length; i++) {
            if (X[kvs[i]].size < X[kvs[j]].size) {
                j = i;
            }
        }
        let c = kvs[j];

        // let c = Object.keys(X).reduce((a, b) => X[a].size <= X[b].size ? a : b);
        // console.log("MIN", c, X, X[c])
        for (let r of [...X[c]]) {
            solution.push(r);
            let cols = select(X, Y, r);
            let cset = new Set();
            for (const col of cols) {
                col?.forEach(e => Y[e].forEach(e2 => cset.add(e2)));
            }
            let good = true;
            for (let col of cset) {
                if (targets[col] < 0) {
                    // console.warn(("bad-- col < 0"));
                    good = false;
                }
            }
            // console.log("cols = ", cols)
            if (good) {
                for (let s of solve(X, Y, solution)) {
                    yield s;
                }
            }
            deselect(X, Y, r, cols);
            solution.pop();
        }
    }
}

let EMPTY_PLACEHOLDER = null;

function select(X, Y, r) {
    let cols = [];
    let ys = [...Y[r]].sort();
    for (let j of ys) {
        targets[j] -= amounts[r][j];
        // TODO: this allows duplicate solutions
        // a solution A B C with duplicates often results in
        //      [ [ A B C ] [ A C B ] ]
        // e.g. "apple" "cans" "snapple" "snap" results in duplicates
        // fix this
        if (targets[j] > 0) {
            cols.push(EMPTY_PLACEHOLDER);
            continue;
        }
        // console.log('gnsel', j, Object.keys(X))
        for (let i of X[j]) {
            for (let k of Y[i]) {
                // console.log('ik', i, k)
                if (k !== j) {
                    // if (!X[k]) X[k] = new Set();
                    cbDel(k, i);
                    X[k].delete(i);
                }
            }
        }
        cols.push([...X[j]]);
        delete X[j];
    }
    return cols;
}

function deselect(X, Y, r, cols) {
    let keys = [...Y[r]].sort();
    for (let i = keys.length - 1; i >= 0; i--) {
        let j = keys[i];
        // let xj = cols.pop();
        let xj = cols.pop();
        if (xj !== EMPTY_PLACEHOLDER) X[j] = new Set(xj); // TODO: this could be a dict merge
        // TODO: change this to allow one tile to cover the same column multiple times
        // console.log(r, j, amounts, amounts[r][j])
        targets[j] += amounts[r][j];
        // console.log("cols:", cols, X[j])
        // console.log('desel', j, X[j]);
        for (let i of X[j]) {
            for (let k of Y[i]) {
                if (k !== j) {
                    // if (!X[k]) X[k] = new Set();
                    // console.log("READD", k)
                    cbAdd(k, i);
                    X[k].add(i);
                }
            }
        }
    }
}
