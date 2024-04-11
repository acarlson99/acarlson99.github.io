// knuth dancing links adapted from
// https://www.cs.mcgill.ca/~aassaf9/python/algorithm_x.html

let X = new Set([1, 2, 3, 4, 5, 6, 7]);
let Y = {
    'A': [1, 4, 7],
    'B': [1, 4],
    'C': [4, 5, 7],
    'D': [3, 5, 6],
    'E': [2, 3, 6, 7],
    'F': [2, 7]
};
// X = new Set([1, 2, 3, 4, 5]);
// Y = {
//     'A': [2, 3, 4],
//     'B': [1, 2, 4, 5],
//     'C': [1, 5],
//     'D': [1, 2, 3, 4],
//     'E': [3],
// };

var cbDel = function () { };
var cbAdd = function () { };

function gothing(X, Y) {
    X = [...X].reduce((acc, j) => {
        acc[j] = new Set(Object.keys(Y).filter(i => Y[i].includes(j)));
        return acc;
    }, {});

    X = Object.keys(X).reduce((acc, j) => {
        acc[j] = new Set();
        // TODO: change this set<char> to a map<char,int>
        // acc[j] = {};
        return acc;
    }, {});

    for (let i in Y) {
        for (let j of Y[i]) {
            X[j].add(i);
        }
    }

    console.log(X, Y)

    let solutions = solve(X, Y);
    let agg = [];
    for (let solution of solutions) {
        // console.log('SOL:', solution);
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
            // console.log("cols = ", cols)
            for (let s of solve(X, Y, solution)) {
                yield s;
            }
            deselect(X, Y, r, cols);
            solution.pop();
        }
    }
}

function select(X, Y, r) {
    let cols = [];
    for (let j of Y[r]) {
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
    let keys = Y[r];
    for (let i = keys.length - 1; i >= 0; i--) {
        let j = keys[i];
        X[j] = new Set(cols.pop());
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

gothing(X, Y);
