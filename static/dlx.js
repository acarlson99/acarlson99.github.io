// knuth dancing links adapted from
// https://www.cs.mcgill.ca/~aassaf9/python/algorithm_x.html

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
