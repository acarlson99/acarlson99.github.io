⍝ dyalogscript tile.dyalog | cat | tr -d ' ' | tr '\\' '\\\\\\' > out.txt

:namespace tile

    f←{3 3⍴(⊃⌷∘⍵)¨1 2 1 2 3 2 1 2 1}

    a←3 3⍴'\|/-╬-/|\'
    b←3 3⍴'#+#+X+#+#'
    c←3 3⍴'/-\|O|\-/'
      t←{
        ⍝ ⍵ ← a b c
        ⍝ ⍺ ← n
      ⍝ TODO: recursively add depth to pattern (somehow)
          ⍺≤1:f ⍵
          ⋄ ta←(⍺-1)∇ ⍵
          ⋄ tb←(⍺-1)∇(1⌽⍵)
          ⋄ tc←(⍺-1)∇(2⌽⍵)
          ⋄ f ta tb tc
      }
    ⍝ ⎕←3 t a b c

    s←3 t a b c
    ⎕←s
:endnamespace
