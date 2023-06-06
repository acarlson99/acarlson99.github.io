-- generate table of dota2 timings

import Control.Monad
import Text.Printf
import System.Environment

asciiGen :: Int -> [(String,[Bool])] -> IO ()
asciiGen maxMin lts = do
  (printFirstCol "") <> (printCols $ map show [0..maxMin]) <> printf "\n"
  (mapM_ (\(a,b) -> (printFirstCol a) <> (printCols $ map (\p -> if p then "XX" else "  ") b) <> printf "\n") lts)
  where
    maxLen = foldr1 max $ map (length . fst) lts
    printFirstCol = printf "%*s --" maxLen
    printCols = foldr ((<>) . printf " %2s |") (return ())

htmlGen :: Int -> [(String,[Bool])] -> IO ()
htmlGen maxMin lts = do
  printf "<table>"
  (printFirstCol "") <> (printCols1 $ map show [0..maxMin]) <> printf "\n"
  (printf "<tr>")<>(mapM_ (\(a,b) -> (printFirstCol a) <> (printCols2 b) <> printf "</tr>\n") lts)
  printf "<table>\n"
  where
    printFirstCol = printf "<td>%s</td>"
    printCols1 = foldr ((<>) . printf "<td>%s</td>") (return ())
    printCols2 = foldr ((<>) . (\p -> (printf "<td ")<>(printf (if p then "style='background-color: green; color: green;'" else "style='opacity:0;'"))<>(printf ">XX</td>"))) (return ())

main :: IO ()
main = do
  args <- getArgs
  case args of
    "html":_ -> htmlGen maxMin lts
    _ -> asciiGen maxMin lts
  where
    maxMin = 35::Int
    lists = liftM2 (,) fst (takeWhile (<=maxMin) . snd) <$> [
        ("gold", [0,3 ..]),
        ("wisdom", [7,14 ..]),
        ("water", [2,4]),
        ("power", [6,8 ..])
        ]
    containedInList n = not . and . map (/=n)
    lts = map (liftM2 (,) fst (sequenceA (map containedInList [0..maxMin]) . snd)) lists
