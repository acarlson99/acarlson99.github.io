-- generate table of dota2 timings

import Control.Exception
import Control.Monad
import System.Environment
import Text.Printf
import Text.Read

asciiGen :: Int -> [(String, [Bool])] -> IO ()
asciiGen maxMin lts = do
  (printFirstCol "") <> (printCols $ map show [0 .. maxMin]) <> printf "\n"
  (mapM_ (\(a, b) -> (printFirstCol a) <> (printCols $ map (\p -> if p then "XX" else "  ") b) <> printf "\n") lts)
  where
    maxLen = foldr1 max $ map (length . fst) lts
    printFirstCol = printf "%*s --" maxLen
    printCols = foldr ((<>) . printf " %2s |") (return ())

htmlGen :: Int -> [(String, [Bool])] -> IO ()
htmlGen maxMin lts = do
  printf "<table>"
  (printFirstCol "") <> (printCols1 $ map show [0 .. maxMin]) <> printf "\n"
  (printf "<tr>") <> (mapM_ (\(a, b) -> (printFirstCol a) <> (printCols2 b) <> printf "</tr>\n") lts)
  printf "<table>\n"
  where
    printFirstCol = printf "<td>%s</td>"
    printCols1 = foldr ((<>) . printf "<td>%s</td>") (return ())
    printCols2 = foldr ((<>) . (\p -> (printf "<td ") <> (printf (if p then "style='background-color: green; color: green;'" else "style='opacity:0;'")) <> (printf ">XX</td>"))) (return ())

usage = "Usage: runhaskell dota-times.hs [MODE] [MIN]\n\tMODE: \"html\" or \"ascii\"\n\t MIN: max time to display"

main :: IO ()
main = do
  args <- getArgs
  case args of
    arg : num : _ -> case readMaybe num of
      Just n -> printTabsArg arg n
      Nothing -> printf "%s\n" usage
    arg : _ -> printTabsArg arg defaultMaxMin
    [] -> printTabsArg "ascii" defaultMaxMin
  where
    defaultMaxMin = 70 :: Int
    printTabsArg "html" = printTabs htmlGen
    printTabsArg "ascii" = printTabs asciiGen
    printTabsArg _ = printf "%s\n" usage

printTabs fn maxMin = fn maxMin lts
  where
    lists =
      liftM2 (,) fst (takeWhile (<= maxMin) . snd)
        <$> [ ("gold", [0, 3 ..]),
              ("wisdom", [7, 14 ..]),
              ("water", [2, 4]),
              ("power", [6, 8 ..])
            ]
    containedInList n = not . notElem n
    lts = map (liftM2 (,) fst (traverse containedInList [0 .. maxMin] . snd)) lists
