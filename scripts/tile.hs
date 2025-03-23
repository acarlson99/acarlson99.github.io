{-# LANGUAGE UndecidableInstances #-}

import Control.Monad (when)
import Data.Maybe (fromJust, fromMaybe)
import System.Console.GetOpt
import System.Environment (getArgs, getProgName)
import Text.Read (readMaybe)

-- BEGIN ALGORITHM

type Matrix a = [[a]]

data TTree a = Node (TTree a) (TTree a) (TTree a) | Leaf a

instance Functor TTree where
  fmap f (Leaf a) = Leaf $ f a
  fmap f (Node a b c) = Node a' b' c'
    where
      a' = fmap f a
      b' = fmap f b
      c' = fmap f c

instance Applicative TTree where
  (<*>) (Leaf f) (Leaf b) = Leaf (f b)
  (<*>) (Node a b c) (Node d e f) = Node (a <*> d) (b <*> e) (c <*> f)
  (<*>) (Node a b c) (Leaf d) = Node (a <*> pure d) (b <*> pure d) (c <*> pure d)
  (<*>) (Leaf f) (Node a b c) = Node (f <$> a) (f <$> b) (f <$> c)
  pure = Leaf

pad :: Int -> a -> [a] -> [a]
pad n x xs = replicate pl x ++ xs ++ replicate (diff - pl) x
  where
    diff = n - length xs
    pl = diff `div` 2

-- TODO: this function will end up taking a `path` arg, and `a,b,c` will
-- become functions of type `path -> a -> b -> c -> Matrix Char`
combine :: Matrix Char -> Matrix Char -> Matrix Char -> Matrix Char
combine a b c = foldl1 (++) [t, m, t]
  where
    maxL = maximum $ map length [a, b, c]
    padTo mx = pad maxL ' ' <$> pad maxL [] mx
    comb = zipWith (++)
    t = foldl1 comb $ map padTo [a, b, a]
    m = foldl1 comb $ map padTo [b, c, b]

class ETree a where
  evalTree :: TTree a -> a

instance (Applicative f) => ETree (f (Matrix Char)) where
  evalTree (Node a b c) = combine <$> a' <*> b' <*> c'
    where
      a' = evalTree a
      b' = evalTree b
      c' = evalTree c
  evalTree (Leaf a) = a

-- TODO: generalize this function, and then create a version of this function which calls `generator` functions instead of walking a tree like a forager
genTree :: a -> a -> a -> Int -> TTree a
genTree a b c 1 = Node (Leaf a) (Leaf b) (Leaf c)
genTree a b c n
  | n <= 0 = genTree a b c 1
  | otherwise = Node a' b' c'
  where
    a' = genTree a b c (n - 1)
    b' = genTree a b c (n - 1)
    c' = genTree a b c (n - 1)

printMatrix :: Matrix Char -> IO ()
printMatrix = mapM_ putStrLn

-- these functions basically make the "pointer" jump around
-- to select patterns in a stable fashion
walkTree :: (Int -> Int) -> (Int -> Int) -> (Int -> Int) -> TTree [Matrix Char] -> TTree (Matrix Char)
walkTree f1 f2 f3 t = rf t 1
  where
    rf :: TTree [Matrix Char] -> Int -> TTree (Matrix Char)
    rf (Node a b c) d = Node (rf a (f1 d)) (rf b (f2 d)) (rf c (f3 d))
    rf (Leaf as) d = pure (cycle as !! d)

-- rf (Leaf as) d = pure . who $ cycle as
--   where
--     who cyc = (cyc !! max 0 d) : who (drop d cyc)

rot n as = drop n as ++ take n as

-- old version, kept for posterity
gen :: [Matrix Char] -> [Matrix Char] -> [Matrix Char] -> Int -> [Matrix Char]
gen a b c 1 = combine <$> a <*> b <*> c
gen a b c n =
  combine <$> a' <*> b' <*> c'
  where
    a' = gen (rot 0 b) (rot 1 c) (rot 2 a) (n - 1)
    b' = gen (rot 1 c) (rot 2 a) (rot 0 b) (n - 1)
    c' = gen (rot 2 a) (rot 0 b) (rot 1 c) (n - 1)

-- END ALGORITHM

-- BEGIN COLORIZER

data Color = Red | Green | Yellow | Blue | Magenta | Cyan | None

colorize :: Color -> String -> String
colorize color s =
  let colorCode = case color of
        Red -> "\ESC[31m"
        Green -> "\ESC[32m"
        Yellow -> "\ESC[33m"
        Blue -> "\ESC[34m"
        Magenta -> "\ESC[35m"
        Cyan -> "\ESC[36m"
        _ -> "\ESC[0m"
      resetCode = "\ESC[0m"
   in colorCode ++ s ++ resetCode

-- END COLORIZER

-- BEGIN OPT

data Mode = ModeWalk | ModeNormal deriving (Show, Eq)

data Options = Options
  { optOutput :: Maybe FilePath,
    optEndless :: Bool,
    optDepth :: Int,
    optMode :: Mode,
    optNth :: Int,
    optSpaced :: Bool,
    optColor :: Bool,
    optLegacy :: Bool -- old algorithm
  }
  deriving (Show)

defaultOptions :: Options
defaultOptions =
  Options
    { optOutput = Nothing,
      optEndless = False,
      optDepth = 2,
      optMode = ModeNormal,
      optNth = 0,
      optSpaced = False,
      optColor = False,
      optLegacy = False
    }

options :: [OptDescr (Options -> Options)]
options =
  [ Option
      ['o']
      ["output"]
      (ReqArg (\arg opts -> opts {optOutput = Just arg}) "FILE")
      "Output file",
    Option
      ['e']
      ["endless"]
      (NoArg (\opts -> opts {optEndless = True}))
      "Turn on endless mode",
    Option
      ['d']
      ["depth"]
      (ReqArg (\arg opts -> opts {optDepth = read arg}) "INT")
      "Depth (small integer)",
    Option
      []
      ["walk"]
      (NoArg (\opts -> opts {optMode = ModeWalk}))
      "walk the tree and find an interesting pattern (instead of selecting `nth`)",
    Option
      ['s']
      ["space"]
      (NoArg (\opts -> opts {optSpaced = True}))
      "add spaces between patterns (makes some larger patterns easier to distinguish)",
    Option
      []
      ["legacy"]
      (NoArg (\opts -> opts {optLegacy = True}))
      "use older algorithm",
    Option
      ['c']
      ["color"]
      (NoArg (\opts -> opts {optColor = True}))
      "color output using ASCII color-escapes (does not work with legacy algorithm)",
    Option
      ['n']
      ["nth"]
      (ReqArg (\arg opts -> opts {optNth = read arg}) "INT")
      "Print nth generated pattern"
  ]

-- END OPT

a =
  [ " ^ ",
    "<#>",
    " V "
  ]

b =
  [ "#.#",
    ".X.",
    "#.#"
  ]

c =
  [ "/_\\",
    "|O|",
    "\\-/"
  ]

d =
  [ "   ",
    " X ",
    "   "
  ]

e =
  [ "# #",
    "   ",
    "# #"
  ]

f =
  [ "\\ /",
    " X ",
    "/ \\"
  ]

everyNth n xs = if n >= length xs then [] else (xs !! max 0 n) : everyNth n (drop n xs)

main :: IO ()
main = do
  args <- getArgs
  progName <- getProgName
  let (actions, nonOptions, errors) = getOpt Permute options args
  if not (null errors)
    then ioError (userError (concat errors ++ usageInfo progName options))
    else do
      let opts = foldl (flip id) defaultOptions actions

          padTree = if optSpaced opts then map (map (++ " ")) else id
          colorMats ms = zipWith (\m c -> colorize c <$> m) ms (cycle $ reverse [Cyan, Red, Blue, Magenta, Green, Yellow])
          colorTree = if optColor opts then fmap colorMats else id

          depth = optDepth opts
          tt = colorTree $ genTree [a, b, c, e] [b, d, e, f] [a, c, d, f] depth
          wt = walkTree (+ 1) (+ 2) (+ 3) tt -- Surely this walking algorithm could be improved
          -- wt = walkTree (+ 1) (`subtract` 2) (\a -> a * a) tt
          -- wt = walkTree (+ 3) (`subtract` 2) (\a -> a * a) tt
          targetTree = if optMode opts == ModeWalk then pure <$> wt else tt
          outputData'
            | optLegacy opts = gen [c, a, d] [b, e, c] [a, f, b] depth
            | otherwise = evalTree $ padTree <$> targetTree
          outputData
            | optEndless opts = outputData'
            -- \| optEndless opts = everyNth (max 1 (optNth opts)) outputData' -- commented out since sanity checks make this take forever
            | otherwise = [cycle outputData' !! optNth opts]
      case optOutput opts of
        Nothing -> mapM_ printMatrix outputData
        Just file -> writeFile file (unlines (map unlines outputData))
