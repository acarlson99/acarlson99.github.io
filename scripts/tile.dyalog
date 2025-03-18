⍝ dyalog -script tile.dyalog

:namespace tile

    fn←{3 3⍴(⊃⌷∘⍵)¨1 2 1 2 3 2 1 2 1}

    a←3 3⍴'\|/-╬-/|\'
    b←3 3⍴'#+#+X+#+#'
    c←3 3⍴'/-\|O|\-/'
    d←3 3⍴'    X    '
    e←3 3⍴'+ +   + +'
    f←3 3⍴' '
      t←{
          ⍺≤1:fn⊃¨⍵
          ⋄ ta←(⍺-1)∇⌽(2⌽¨⍵)
          ⋄ tb←(⍺-1)∇(1⌽(3⌽¨⍵))
          ⋄ tc←(⍺-1)∇(2⌽(1⌽¨⍵))
          ⋄ fn ta tb tc
      }

    res← 3 t (c a d) ((⍉b) e (⍉c)) (f (⍉a) b)
    ⎕PW←⊃⌈/⍴⍕res

    table←⍕res
    mask←∧/[1](' '≠⍕{'X'}¨¨¨¨¨¨¨¨res)
    ⍝⎕←mask/table ⍝ without spaces
    ⎕←table      ⍝ with spaces
:endnamespace
