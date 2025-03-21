type Matrix a = [[a]]

combine :: Matrix Char -> Matrix Char -> Matrix Char -> Matrix Char
combine a b c = foldl1 (++) [t, m, t]
  where
    comb = zipWith (++)
    t = foldl1 comb [a, b, a]
    m = foldl1 comb [b, c, b]

rot n as = drop n as ++ take n as

gen :: (Eq a, Num a) => ([Matrix Char], [Matrix Char], [Matrix Char]) -> a -> [Matrix Char]
gen (a, b, c) 1 = combine <$> a <*> b <*> c
gen (a, b, c) n =
  combine <$> a' <*> b' <*> c'
  where
    a' = gen (rot 0 b, rot 1 c, rot 2 a) (n - 1)
    b' = gen (rot 1 c, rot 2 a, rot 0 b) (n - 1)
    c' = gen (rot 2 a, rot 0 b, rot 1 c) (n - 1)

printMatrix :: Matrix Char -> IO ()
printMatrix = mapM_ putStrLn

main :: IO ()
main = do
  let depth = 5
      pad = map (++ " ")
      a =
        pad
          [ " ^ ",
            "<#>",
            " V "
          ]
      b =
        pad
          [ "#.#",
            ".X.",
            "#.#"
          ]
      c =
        pad
          [ "/_\\",
            "|O|",
            "\\-/"
          ]
      d =
        pad
          [ "   ",
            " X ",
            "   "
          ]
      e =
        pad
          [ "# #",
            "   ",
            "# #"
          ]
      f =
        pad
          [ "\\ /",
            " X ",
            "/ \\"
          ]
      head_ (a : _) = a
  printMatrix . head_ $ gen ([c, a, d], [b, e, c], [a, f, b]) depth
