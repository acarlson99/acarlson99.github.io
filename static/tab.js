
function newInput(x, y) {
    let input = document.createElement("input");
    input.type = "text";
    input.placeholder = x + "," + y
    input.id = x + "," + y;
    input.classList = "row-" + x + ' ' + "col-" + y;
    // input.onchange = function () {
    //     updateCellValue(x, y, input.value);
    // };
    return input
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
    let inp = newInput(0, y);
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
        console.log(i, y)
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
    return gothing(xy.x, xy.y)
}

function cellValueOrPlaceholder(cell) {
    return cell.children[0].value || cell.children[0].placeholder
}

function tabToDLX() {
    let table = document.getElementById("myTable");
    let rowHeader = table.rows[0];
    console.log(rowHeader);
    let m = {};
    let s = new Set();
    for (let i = 1; i < rowHeader.cells.length; i++) {
        let v = cellValueOrPlaceholder(rowHeader.cells[i]);
        m[v] = i;
        s.add(i)
    }

    let Ys = {};
    console.log(m)
    for (let y = 1; y < table.rows.length; y++) {
        let name = cellValueOrPlaceholder(table.rows[y].cells[0]);
        if (!Ys[name]) Ys[name] = [];
        else console.warn("duplicate name detected", name)
        for (let x = 1; x < table.rows[y].cells.length; x++) {
            console.log(x, y)
            let val = cellValueOrPlaceholder(table.rows[y].cells[x]);
            if (val == "1") {
                Ys[name].push(x)
            }
        }
    }
    return {
        x: s,
        y: Ys,
    }
}

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

function rowIdentIdx(v) {
    let tab = document.getElementById("myTable");
    let r = tab.rows;
    for (let i = 1; i < r.length; i++) {
        let e = r[i].cells[0];
        console.log(e);
        if (cellValueOrPlaceholder(e) == v) {
            return i;
        }
    }
    return -1;
}

// function sleep(milliseconds) {
//     const start = new Date().getTime();
//     while (new Date().getTime() - start < milliseconds) { }
// }

// TODO: below functions should work async (sorta)

cbDel = async function (r, c) {
    console.log("DEL", r, c);

    let col = rowIdentIdx(c);
    // let id = col + ',' + r;
    // console.log(id)
    let cellsC = document.getElementsByClassName("col-" + col)
    Object.values(cellsC).map(e => e.style.background = "red")
    let cellsR = document.getElementsByClassName("row-" + r)
    Object.values(cellsR).map(e => e.style.background = "red")

    // sleep(3 * 1000)
}

cbAdd = async function (r, c) {
    console.log("ADD", r, c);

    let col = rowIdentIdx(c);
    // let id = col + ',' + r;
    // console.log(id)
    let cellsC = document.getElementsByClassName("col-" + col)
    Object.values(cellsC).map(e => e.style.background = "green")
    let cellsR = document.getElementsByClassName("row-" + r)
    Object.values(cellsR).map(e => e.style.background = "green")

    // console.log("SLEEP")
    // sleep(3 * 1000)
    // console.log("SLEPT")
}

// TODO: preload table with data, and/or store in URL
