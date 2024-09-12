function clearCellStyles() {
    for (let i = 0; ; i++) {
        let es = [...document.getElementsByClassName("row-" + i)];
        if (es.length === 0) break;
        es.forEach(uncolorCell);
    }
}

function selectState(i) {
    return execState(states[i]);
}

function colorCell(cell, color) {
    let didChange = false;
    if (!cell.colorStack) {
        cell.colorStack = [];
    }
    didChange = true;
    cell.colorStack.push(cell.style.background);
    cell.style.background = color;
    return didChange;
}

function uncolorCell(cell) {
    if (!cell.colorStack) return false;
    cell.style.background = cell.colorStack.pop();
    return true;
}

function colorRow(r, color) {
    if (Number(r) != r) console.warn("colorRow should be called with a number; got", r);

    let didChange = false;
    [...document.getElementsByClassName('row-' + r)].forEach(cell => didChange |= colorCell(cell, color))
    return didChange;
}

function uncolorRow(r) {
    if (Number(r) != r) console.warn("colorRow should be called with a number; got", r);

    let didChange = false;
    [...document.getElementsByClassName('row-' + r)].forEach(cell => didChange |= uncolorCell(cell))
    return didChange;
}

function execState(si) {
    console.log(si);
    si.ii = rowIdentIdx(si.i);
    // TODO: add `changedSomething` return bool
    let didChange = false;
    switch (si.type) {
        case "ADDROW":
            didChange |= uncolorRow(si.ii);
            break;
        case "DELROW":
            didChange |= colorRow(si.ii, 'black');
            break;
        case "ADDCOL":
            didChange |= uncolorCell(document.getElementById("0," + si.i));
            break;
        case "DELCOL":
            didChange |= colorCell(document.getElementById("0," + si.i), 'black');
            break;
        case "SELECT":
            // CSS select row i
            didChange |= colorRow(si.ii, 'orange');
            break;
        case "DESELECT":
            didChange |= uncolorRow(si.ii);
            break;
        case "REM":
            [...document.getElementsByClassName("row-" + si.ii)].forEach(cell => {
                if (!cell.classList.contains("col-" + si.k)) return;
                didChange |= colorCell(cell, 'black');
            })
            break;
        case "ADD":
            [...document.getElementsByClassName("row-" + si.ii)].forEach(cell => {
                if (!cell.classList.contains("col-" + si.k)) return;
                didChange |= uncolorCell(cell);
            })
            break;
        case "FOUND SOLUTION":
            si.s.forEach(i => {
                r = rowIdentIdx(i);
                didChange |= colorRow(r, 'white');
            });
            break;
        case "UN FOUND SOLUTION":
            si.s.forEach(i => {
                r = rowIdentIdx(i);
                didChange |= uncolorRow(r);
            });
            break;
        default:
            console.log("Should not get here; input:", si);
    }
    console.log(didChange);
    return didChange;
}

var stateI = undefined; // if undef then start at 0
function gotoState(i) {
    if (i === undefined || isNaN(i)) i = 0;
    if (stateI === undefined) {
        stateI = 0;
        selectState(0);
    }
    if (i < stateI) return false; // cannot go backwards yet :/
    while (stateI < states.length - 1 && stateI >= 0 && stateI !== i) {
        if (stateI < i) stateI++;
        else stateI--;
        if (stateI > states.length) return false;
        selectState(stateI);
    }
}

function nextState() {
    let i = stateI;
    if (!i) i = 0;
    while (i < states.length && !selectState(i++)) { }
    stateI = i;
    if (!states[stateI]) {
        console.warn("end of state list");
    }
}

let cnt = 0;
let states = [];
var cbSelect = function (r, b) {
    // if (b) console.log("SELECT", r);
    // else console.log("DESELECT", r);

    states.push({
        type: b ? "SELECT" : "DESELECT",
        i: r,
    })
}
var cbDel = function (k, i) {
    // console.log("REMOVING", k, i);
    cnt++;
    states.push({
        type: "REM",
        k: k,
        i: i,
    })
};
var cbDelRow = function (i) {
    cnt++;
    states.push({
        type: "DELROW",
        i: i,
    })
};
var cbAddRow = function (i) {
    cnt++;
    states.push({
        type: "ADDROW",
        i: i,
    })
};
var cbDelCol = function (i) {
    cnt++;
    states.push({
        type: "DELCOL",
        i: i,
    })
};
var cbAddCol = function (i) {
    cnt++;
    states.push({
        type: "ADDCOL",
        i: i,
    })
};
var cbAdd = function (k, i) {
    // console.log("ADDING", k, i);
    cnt++;
    states.push({
        type: "ADD",
        k: k,
        i: i,
    })
};
var cbSolved = function (solution) {
    states.push({
        type: "FOUND SOLUTION",
        s: solution,
    })
    states.push({
        type: "UN FOUND SOLUTION",
        s: solution,
    })
}