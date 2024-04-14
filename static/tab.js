///////////////////////////////////////////////////////////////////////////////
//                              Row/Col funcs                                //
///////////////////////////////////////////////////////////////////////////////

function newInput(x, y) {
    let input = document.createElement("input");
    input.type = "text";
    input.placeholder = x + "," + y
    input.id = x + "," + y;
    input.classList = "row-" + x + ' ' + "col-" + y;
    // input.style.width = '4em';
    input.style.width = '8em';
    // input.onchange = function () {
    //     updateCellValue(x, y, input.value);
    // };
    return input
}

// new input for first row in col
// contains input for name and amount
function newColInput(y) {
    let input = newInput(0, y);
    input.style.width = '4em';
    input.placeholder = 'COL ' + y;
    // let button = document.createElement("button");
    let amtInp = document.createElement("input");
    amtInp.type = "text";
    amtInp.placeholder = "amount";
    amtInp.id = "amt-col-" + y;
    amtInp.classList = "input-col-" + y;
    amtInp.style.width = '4em';
    amtInp.defaultValue = 1;

    let body = document.createElement("div");
    body.appendChild(input);
    body.appendChild(amtInp);
    return body;
}

function newCol() {
    let table = document.getElementById("myTable");
    let numRows = table.rows.length;
    if (numRows == 0) {
        return newRow();
    }
    let row = table.rows[0];
    let y = row.cells.length; // y-coordinate (column index)

    let newCell = row.insertCell(-1);
    // let inp = newInput(0, y);
    let inp = newColInput(y);
    inp.placeholder = "COL " + y;
    // inp.onchange = function () {
    //     changeColLabelFor(y)
    // }
    newCell.appendChild(inp)

    for (let i = 1; i < numRows; i++) {
        let row = table.rows[i];
        let newCell = row.insertCell(-1);
        let x = i; // x-coordinate (row index)

        newCell.appendChild(newInput(x, y))
        // console.log(i, y)
    }
}

function delCol() {
    let table = document.getElementById("myTable");
    let rowCount = table.rows.length;

    // Loop through each row and remove the last cell
    for (let i = 0; i < rowCount; i++) {
        let row = table.rows[i];
        let cellCount = row.cells.length;

        if (cellCount > 1) { // Ensure there's at least one cell to remove
            row.deleteCell(-1); // Remove the last cell
        }
    }
}

function newRow() {
    let table = document.getElementById("myTable");
    let newRow = table.insertRow(-1); // Insert new row at the end of the table
    let numCols = table.rows[0].cells.length;
    if (numCols == 0) numCols = 1;
    let x = table.rows.length - 1;

    let inp = newInput(x, 0)
    inp.placeholder = "ROW " + x
    // inp.onchange = function () {
    //     changeRowLabelFor(x)
    // }
    let newCell = newRow.insertCell(-1)
    newCell.appendChild(inp);
    // Loop through each column and add a new cell to the row
    for (let i = 1; i < numCols; i++) {
        let newCell = newRow.insertCell(-1); // Insert new cell at the end of the row
        newCell.appendChild(newInput(x, i))
    }
}

function delRow() {
    let table = document.getElementById("myTable");
    let rowCount = table.rows.length;
    if (rowCount > 1) {
        table.deleteRow(-1);
    }
}

function getTableRows() {
    let table = document.getElementById("myTable");
    return table.rows.length
}


function getTableCols() {
    let table = document.getElementById("myTable");
    return table.rows[0].cells.length
}

function setTabW(w) {
    let n = w - getTableCols();
    for (let i = 0; i < Math.abs(n); i++) {
        if (n < 0) {
            delCol();
        } else {
            newCol();
        }
    }
}

function setTabH(h) {
    let n = h - getTableRows();
    for (let i = 0; i < Math.abs(n); i++) {
        if (n < 0) {
            delRow();
        } else {
            newRow();
        }
    }
}

function setTabWH(w, h) {
    setTabH(h);
    setTabW(w);
}

function cellValue(cell) {
    let isColHeaderNode = cell.children[0].tagName == 'DIV';
    if (isColHeaderNode) {
        return cellValue(cell.children[0]);
    }
    return cell.children[0].value
}

function cellValueOrPlaceholder(cell) {
    let isColHeaderNode = cell.children[0].tagName == 'DIV';
    if (isColHeaderNode) {
        return cellValueOrPlaceholder(cell.children[0]);
    }
    return cellValue(cell) || cell.children[0].placeholder
}

// index of col with name `v`
function colIdentIdx(v) {
    let tab = document.getElementById("myTable");
    let r = tab.rows[0];
    for (let i = 1; i < r.cells.length; i++) {
        let e = r.cells[i];
        if (cellValueOrPlaceholder(e) == v) {
            return i;
        }
    }
    return -1;
}

// index of row with name `v`
function rowIdentIdx(v) {
    let tab = document.getElementById("myTable");
    let r = tab.rows;
    for (let i = 1; i < r.length; i++) {
        let e = r[i].cells[0];
        // console.log(e);
        if (cellValueOrPlaceholder(e) == v) {
            return i;
        }
    }
    return -1;
}

///////////////////////////////////////////////////////////////////////////////
//                            END Row/Col funcs                              //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
//                          Objects to/from table                            //
///////////////////////////////////////////////////////////////////////////////

function dlxToTab(X, Y, targets, amounts) {
    let w = X.size + 1;
    let h = Object.keys(Y).length + 1;
    setTabWH(w, h);
    let xs = [...X].sort();
    for (let j = 0; j < xs.length; j++) {
        const i = xs[j];
        let amtcol = document.getElementById("amt-col-" + i);
        if (amtcol) amtcol.value = targets[i] || 1;
        else console.warn("unable to set col", j);
        let cell = document.getElementById("0," + i);
        if (cell) cell.value = i;
        else console.warn("unable to set col", j);
    }
    let i = 0;
    for (const [k, v] of Object.entries(Y)) {
        i++;

        let firstCol = document.getElementById(i + ",0");
        if (firstCol) firstCol.value = k;
        else console.warn("unable to set row header", i);

        v.forEach(c => {
            let cell = document.getElementById(i + "," + c);
            if (cell) cell.value = amounts[k][c];
            else console.warn("unable to set cell", k, c);
        });
    }
}

function tabToDLX() {
    let table = document.getElementById("myTable");
    let rowHeader = table.rows[0];
    let m = {};
    let s = new Set();
    for (let i = 1; i < rowHeader.cells.length; i++) {
        let v = cellValueOrPlaceholder(rowHeader.cells[i]);
        m[v] = i;
        s.add(i)
    }

    let Ys = {};
    let amounts = {};
    let targets = {};
    for (let x = 1; x < table.rows[0].cells.length; x++) {
        let amtcol = document.getElementById("amt-col-" + x);
        if (amtcol) targets[x] = Number(amtcol.value);
        if (!targets[x]) targets[x] = 1;
    }
    for (let y = 1; y < table.rows.length; y++) {
        let name = cellValueOrPlaceholder(table.rows[y].cells[0]);
        amounts[name] = {};
        if (!Ys[name]) Ys[name] = new Set();
        else console.warn("duplicate name detected", name)
        for (let x = 1; x < table.rows[y].cells.length; x++) {
            if (cellValue(table.rows[y].cells[x]) == "") continue;

            let n = Number(cellValue(table.rows[y].cells[x]));
            if (isNaN(n) || n === undefined || !n) {
                amounts[name][x] = 1;
            }
            else {
                amounts[name][x] = n;
            }
            Ys[name].add(x);
        }
    }
    return {
        x: s,
        y: Ys,
        amounts: amounts,
        targets: targets,
    }
}

///////////////////////////////////////////////////////////////////////////////
//                        END Objects to/from table                          //
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
//                                   URL                                     //
///////////////////////////////////////////////////////////////////////////////

function encodeStateURL(X, Y, targets, amounts) {
    let x = btoa(JSON.stringify([...X]));
    let ny = {};
    for (let [k, v] of Object.entries(Y)) {
        ny[k] = [...v];
    }
    let y = btoa(JSON.stringify(ny));
    console.log(ny, y)
    let ts = btoa(JSON.stringify(targets));
    let as = btoa(JSON.stringify(amounts));

    return `x=${x}&y=${y}&ts=${ts}&as=${as}`
}

function decodeStateURL(s) {
    let params = new URL('http://a?' + s).searchParams;
    let x = new Set(JSON.parse(atob(params.get('x'))))
    let y = JSON.parse(atob(params.get('y')))
    for (let k of Object.keys(y)) {
        y[k] = new Set(y[k]);
    }
    console.log(y)
    let as = JSON.parse(atob(params.get('as')))
    let ts = JSON.parse(atob(params.get('ts')))

    return {
        x: x,
        y: y,
        amounts: as,
        targets: ts,
    };
}

function _testRoundtripStateURL(X, Y, targets, amounts) {
    let s = encodeStateURL(X, Y, targets, amounts);
    let o = decodeStateURL(s);
    let good = true;
    for (let [k, v] of Object.entries(Y)) {
        let want = JSON.toString([...v]);
        let got = JSON.toString([...o.y[k]]);
        if (!(o.y[k] instanceof Set)) {
            console.warn("bad type for key", k, "should be Set", o.y[k]);
        }
        if (got != want) {
            console.warn("bad conversion", want, got);
        }
    }
    // [Y, o.y], // TODO: check Y
    for (let [want, got] of [
        [JSON.stringify([...X]), JSON.stringify([...o.x])],
        [JSON.stringify(targets), JSON.stringify(o.targets)],
        [JSON.stringify(amounts), JSON.stringify(o.amounts)],
    ]) {
        if (want != got) {
            console.warn("bad conversion", want, got)
            good = false;
        }
    }
    return good;
}

// TODO: auto-update URL when changing state
// TODO: auto-populate table from URL when page loads
function loadTabFromStateURL() {
    // s ~ "x=X&y=YS&as=AS&ts=TS"
    let s = new URL(document.location.href).searchParams.toString();
    let o = decodeStateURL(s);
    console.log(o);
    dlxToTab(o.x, o.y, o.targets, o.amounts);
}

///////////////////////////////////////////////////////////////////////////////
//                                 END URL                                   //
///////////////////////////////////////////////////////////////////////////////

// let X = new Set([1, 2, 3, 4, 5, 6, 7]);
// let Y = {
//     'A': [1, 4, 7],
//     'B': [1, 4],
//     'C': [4, 5, 7],
//     'D': [3, 5, 6],
//     'E': [2, 3, 6, 7],
//     'F': [2, 7]
// };

function go() {
    let xy = tabToDLX();
    console.log("go for", xy);
    // document.location.search = encodeStateURL(xy.x, xy.y, xy.targets, xy.amounts)
    let url = new URL(window.location);
    window.history.replaceState({}, "", url.pathname + '?' + encodeStateURL(xy.x, xy.y, xy.targets, xy.amounts))
    return gothing(xy.x, xy.y, xy.targets, xy.amounts);
}

// function sleep(milliseconds) {
//     const start = new Date().getTime();
//     while (new Date().getTime() - start < milliseconds) { }
// }

// TODO: option to highlight rows of a proposed answer
// TODO: below functions should work async (sorta)

// cbDel = async function (r, c) {
//     // console.log("DEL", r, c);

//     let col = rowIdentIdx(c);
//     // let id = col + ',' + r;
//     // console.log(id)
//     let cellsC = document.getElementsByClassName("col-" + col)
//     Object.values(cellsC).map(e => e.style.background = "red")
//     let cellsR = document.getElementsByClassName("row-" + r)
//     Object.values(cellsR).map(e => e.style.background = "red")

//     // sleep(3 * 1000)
// }

// cbAdd = async function (r, c) {
//     // console.log("ADD", r, c);

//     let col = rowIdentIdx(c);
//     // let id = col + ',' + r;
//     // console.log(id)
//     let cellsC = document.getElementsByClassName("col-" + col)
//     Object.values(cellsC).map(e => e.style.background = "green")
//     let cellsR = document.getElementsByClassName("row-" + r)
//     Object.values(cellsR).map(e => e.style.background = "green")

//     // console.log("SLEEP")
//     // sleep(3 * 1000)
//     // console.log("SLEPT")
// }

// TODO: preload table with data, and/or store in URL
