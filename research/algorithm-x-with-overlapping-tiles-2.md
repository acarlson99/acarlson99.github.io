# Algorithm X Overlap Redux

In another [writing](./algorithm-x-with-overlapping-tiles) I discuss a method of encoding double letters in Algorithm-X, and generalize to any tile overlapping.

# An alternate encoding

There exists an alternate encoding which requires no modification of the algorithm.

Take, for example, the word list `"troll" "lisp"`.  This can be encoded by mapping each letter to a column like so

|       | t | r | o | l_1 | l_2 | i | s | p |
|-------|---|---|---|-----|-----|---|---|---|
| troll | 1 | 1 | 1 | 1   | 1   | 0 | 0 | 0 |
| lisp  | 0 | 0 | 0 | 1   | 0   | 1 | 1 | 1 |

Obviously this does not work.  `lisp` should be able to occupy either `l_1` or `l_2`.  This complication can be remidied by adding multiple instances of `lisp` like this

|        | t | r | o | l_1 | l_2 | i | s | p | lisp |
|--------|---|---|---|-----|-----|---|---|---|------|
| troll  | 1 | 1 | 1 | 1   | 1   | 0 | 0 | 0 | 0    |
| lisp_1 | 0 | 0 | 0 | 1   | 0   | 1 | 1 | 1 | 1    |
| lisp_2 | 0 | 0 | 0 | 0   | 1   | 1 | 1 | 1 | 1    |

Adding an instance of the word `lisp` for `l_1` and `l_2` allows `troll` to use `l` twice without introducing an overlap.  Additionally, to enforce the usual restriction of using words only once we can add a column for the word `lisp` to ensure that it is only used once.

# Pros/Cons

This encoding allows one to allow for overlapping tiles without requiring a change to the core algorithm.  However, this comes at a (sometimes significant) memory cost.  Simply encoding `troll` requires one additional row and column.  Were I to encode another double-letter e.g. `tool` the matrix must enlarge again, adding more instances for `troll` to account for the double `o`:

|         | t | r | o_1 | o_2 | l_1 | l_2 | i | s | p | lisp | tool | troll |
|---------|---|---|-----|-----|-----|-----|---|---|---|------|------|-------|
| troll_1 | 1 | 1 | 1   | 0   | 1   | 1   | 0 | 0 | 0 | 0    | 0    | 1     |
| troll_2 | 1 | 1 | 0   | 1   | 1   | 1   | 0 | 0 | 0 | 0    | 0    | 1     |
| lisp_1  | 0 | 0 | 0   | 0   | 1   | 0   | 1 | 1 | 1 | 1    | 0    | 0     |
| lisp_2  | 0 | 0 | 0   | 0   | 0   | 1   | 1 | 1 | 1 | 1    | 0    | 0     |
| tool_1  | 1 | 0 | 1   | 1   | 1   | 0   | 0 | 0 | 0 | 0    | 1    | 0     |
| tool_2  | 1 | 0 | 1   | 1   | 0   | 1   | 0 | 0 | 0 | 0    | 1    | 0     |

In fact, this growth is combinatorial because each overlapping instance up to doubles the number of rows required (not to mention much worse cases where you want to overlap 10 tiles on one space) and adds an additional column.  For larger search instances this quickly becomes infeasible.

The key advantage provided by the [modified algorithm](./algorithm-x-with-overlapping-tiles.md) is its negligible memory footprint.
