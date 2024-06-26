/*
functions for the card game quiddler

basically you lay 8 cards on the table and then take cards to spell words,
and you get more points for wacky letters and long words, then fill spaces
with remaining cards and repeat until you are out of cards

This DLX implementation was meant to assist in solving this, but it cannot,
as an optimal solution could easily leave 1 or 2 letters unused.

Somewhat vestigial, but still a neat letter word matcher.
*/


// TODO: debug this.  For some reason this test case produces answers with
// different numbers of letters.  Should get 17 only,
// but new Set([...uniqueRes.map(a=>a.join('').length)]) contains [13,14,15,17]
let cardObs = { "cards": ["L", 3, "O", 2, "J", 13, "O", 2, "E", 2, "L", 3, "T", 3, "I", 2, "Q", 15, "X", 12, "I", 2, "T", 3, "TH", 9, "B", 8, "O", 2, "H", 7], "date": "2024-03-25", "words": ["be", "bel", "bell", "belt", "bet", "beth", "bhoot", "bi", "bile", "bill", "billet", "billie", "bio", "biotite", "bit", "bite", "bitt", "blet", "blite", "blithe", "blot", "blote", "blotto", "bo", "boh", "boho", "boi", "boil", "boite", "bole", "boleti", "boll", "bollix", "bollox", "bolo", "bolt", "boo", "boot", "booth", "bootie", "bot", "bote", "botel", "both", "bott", "bottle", "box", "eh", "ejoo", "el", "elhi", "elix", "ell", "elt", "eolith", "et", "eth", "ex", "exhibit", "exit", "exo", "extol", "extoll", "he", "heil", "helio", "helix", "hell", "hellbox", "hello", "helo", "helot", "het", "heth", "hex", "hi", "hie", "hili", "hill", "hillo", "hilt", "hit", "ho", "hob", "hobo", "hoe", "hoi", "hoit", "hole", "hollo", "holloo", "holt", "hoo", "hoolie", "hoot", "hot", "hotbox", "hote", "hotel", "hox", "ibex", "ile", "ilex", "ill", "illite", "io", "iolite", "it", "ixtle", "jell", "jello", "jet", "jib", "jibe", "jill", "jilt", "jo", "job", "joe", "jol", "jole", "joll", "jolt", "jot", "lei", "let", "lex", "li", "lib", "libel", "lie", "lilt", "lit", "lite", "lith", "lithe", "litho", "little", "lo", "lob", "lobe", "lobo", "loo", "loob", "looie", "lool", "loot", "lot", "lote", "loth", "loti", "lotte", "lotto", "lox", "obe", "obeli", "obi", "obit", "obo", "oboe", "obol", "obole", "oboli", "oe", "oh", "oho", "oi", "oil", "oilhole", "ojo", "ole", "oleo", "olio", "oo", "ooh", "oolite", "oolith", "oot", "otolith", "otto", "ox", "oxo", "qi", "qibli", "te", "tel", "tell", "teloi", "tet", "teth", "tex", "text", "the", "thill", "thio", "thiol", "tho", "thole", "tholoi", "ti", "tie", "til", "tile", "till", "tilt", "tilth", "tit", "tith", "tithe", "titi", "title", "to", "toe", "toil", "toile", "toilet", "toit", "tol", "tolbooth", "tole", "toll", "tollbooth", "tolt", "too", "tool", "toolbox", "toot", "tooth", "tootle", "tot", "tote", "xi"] };

CARD_VAL = {
    "-": 0,
    "A": 2, "B": 8, "C": 8, "D": 5, "E": 2, "F": 6,
    "G": 6, "H": 7, "I": 2, "J": 13, "K": 8, "L": 3,
    "M": 5, "N": 5, "O": 2, "P": 6, "Q": 15, "R": 5,
    "S": 3, "T": 3, "U": 4, "V": 11, "W": 10, "X": 12,
    "Y": 4, "Z": 14,
    "CL": 10, "ER": 7, "IN": 7, "QU": 9, "TH": 9,
}

BONUS = [0, 0, 0, 0, 0, 2, 5, 10, 20, 30, 40, 50, 60, 70]

PUZZLE_DATE_REGEX = "\$\(\"\#quitter-puzzle_id\"\)\.val\(\"(\d{2}\/\d{2}\/\d{4})\"\)"
PUZZLE_DATA_REGEX = "dictionary\.init\(\"([a-z\",]+)\"\);board = new QuiddlerBoard\(dictionary, gameOver,1,\"\.\.\"\);board\.loadCards\(([\"A-Z,0-9]+)\)"

/*
let o = convertCardObs(cardObs);
let xs = uniqueRes[0].map(w => wordToCards(w,o.cards));
calcScore([], xs)
*/

// score a guess given words and cards
// words = ["cat", "hat"]
// cards = ["h", "c", "a", "t", "a", "t"]
function scoreGuess(words, cards) {
    let cmap = {};
    for (let c of cards) {
        if (!cmap[c]) cmap[c] = 0;
        cmap[c] += 1;
    }

    let wcss = words.map(w => wordToCards(w, cards));
    for (let i = 0; i < wcss.length; i++) {
        // let wcs = wordToCards(word, cards);
        let wcs = wcss[i];
        for (let wc of wcs) {
            if (!cmap[wc]) {
                console.warn("Illegal letter", wc, "used in solution", words[0])
            }
            cmap[wc] -= 1;
            if (cmap[wc] === 0) delete cmap[wc];
        }
    }
    let ln = (v, n) => { if (n === 0) return []; let _l = ln(v, n - 1); _l.push(v); return _l; }
    let cardsLeft = Object.keys(cmap).map(k => ln(k, cmap[k]));
    return calcScore(cardsLeft, words);
}

function wordToCards(w, cards) {
    cards = cards.sort((a, b) => b.length - a.length);

    let agg = [];
    let i = 0;
    while (w != '') {
        if (!cards[i]) return false;
        let s = removeSubstr(w, cards[i]);
        if (w == s) {
            i++;
            continue;
        }
        agg.push(cards[i]);
        w = s;
    }
    return agg;
}

function calcScore(boardCards, wordCards) {
    // assuming wordCards is an array of arrays of cards representing words
    // and boardCards is letters left on the board
    var penalty = 0
    var score = 0
    var length = 0
    boardCards.forEach(elem => { penalty += CARD_VAL[elem]; })
    // wordCards.forEach(word => {
    //     word.forEach(card => {
    //         length += card.length;
    //         score += CARD_VAL[card];
    //     })
    //     score += BONUS[length];
    // })
    // let wo = wordCards[0].map(c => {
    let wf = (ws) => {
        console.log(ws)
        let wo = ws.map(c => {
            return { l: c.length, s: CARD_VAL[c] }
        }).reduce((acc, a) => {
            return { l: acc.l + a.l, s: acc.l + a.l }
        }, { l: 0, s: 0 });
        return wo.s + BONUS[wo.l];
    }
    return wordCards.reduce((acc, b) => wf([...b]) + acc, 0) - penalty;
}

function removeSubstr(s, needle) {
    if (!needle) console.warn("no set needle");
    let i = s.indexOf(needle);
    if (i < 0) return s;
    return s.slice(0, i) + s.slice(i + needle.length);
}

// NOTE: this strategy DOES NOT ALWAYS WORK
// in cases of ambiguous decoding it will
// always do the longest string first
// e.g.
// convertCardObs({
//     cards: ["ab", 1, "a", 2, "b", 1, "c", 1],
//     words: ["ab", "abc"]
// })
// There is clearly a solution, but these will be improperly
// encoded and unable to find it.
function convertCardObs(cardObs) {
    let namedTargets = {};
    let cards = [];
    for (let i = 0; i < cardObs.cards.length; i++) {
        if (i % 2 == 1) continue;
        const c = cardObs.cards[i].toUpperCase();

        cards.push(c);
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

    let amounts = {};
    let Y = {};
    for (let word of cardObs.words) {
        word = word.toUpperCase()
        let s = word;
        let letterCounts = {};
        let arr = [];
        for (let i_ = 0; i_ < xs.length; i_++) {
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
        }
        amounts[word] = letterCounts;
    }
    return {
        x: new Set(Object.keys(targets).map(Number)),
        y: Y,
        targets: targets,
        amounts: amounts,

        cards: cards,
    };
}