@echo off
:: This forces the script to run in the exact folder where the .bat file lives
cd /d "%~dp0"

echo Compiling all CSV files to JSON...
python csv_to_json.py
echo Done.
pause