# curl https://raw.githubusercontent.com/acarlson99/acarlson99.github.io/master/scripts/colors.sh | bash -l
P=(  █ ░ ▒ ▓)
while :;do
printf "\e[9$(( ( RANDOM % 7 )  + 1 ))m\e[$[RANDOM%$LINES+1];$[RANDOM%$COLUMNS+1]f${P[$RANDOM%5]}"
done
