# MediaLupa for Windows 1.1.1

Samostatná desktopová edice MediaLupy pro Windows 10/11 (64 bit). Je navržena jako offline-first správce fotografií a videí.

## Co je v této verzi funkční

- Přidání jedné nebo více lokálních složek a rekurzivní skenování.
- Indexování JPG/JPEG, PNG, WebP, BMP, GIF, TIFF a běžných video formátů MP4, MKV, MOV, AVI, WMV, WebM, M4V, 3GP, MTS/M2TS.
- Náhledy fotografií a video snímků, metadata, velikost a rozměry.
- SQLite index uložený lokálně v profilu uživatele.
- Inkrementální skenování – nezměněné soubory se znovu neanalyzují.
- Přesné hledání podle názvu, cesty, AI štítků a OCR textu.
- Přesné duplicity podle SHA-256 a vizuálně podobné snímky podle perceptuálního hashe (přibližné shody).
- Volitelná lokální vizuální AI CLIP: štítky obsahu a vyhledávání větou v přirozeném jazyce.
- Volitelné OCR přes Tesseract (čeština + angličtina).
- Synchronizované složky OneDrive, Google Drive pro počítače a Dropboxu lze přidat stejně jako běžné složky.
- Originální soubory se automaticky nemažou, nepřesouvají ani neupravují.

## Instalace a spuštění ze zdrojového projektu

1. Nainstaluj 64bit Python 3.12 z https://www.python.org/downloads/windows/ (zaškrtni „Add Python to PATH“).
2. Rozbal celý projekt do běžné složky, například `C:\MediaLupa`.
3. Spusť `RUN_WINDOWS.bat`.
4. V aplikaci zvol **Přidat složku** a potom **Skenovat**.

## Aktivace lokální AI

1. Spusť `INSTALL_AI.bat`.
2. V aplikaci označ fotografie/videa a klikni na **Analyzovat AI**.
3. Při prvním použití se stáhnou modely `sentence-transformers/clip-ViT-B-32` (obrazový encoder) a `sentence-transformers/clip-ViT-B-32-multilingual-v1` (český vícejazyčný textový encoder), celkem řádově stovky MB. Oba se uloží do lokální cache Hugging Face. Po stažení probíhá analýza i vizuální hledání lokálně; při běžném používání už není potřeba odesílat média na server.
4. Pro vyhledávání přepni režim na **Vizuální AI**, zadej například `bílý pes v trávě` nebo `západ slunce nad vodou`.

Poznámka: CLIP poskytuje vizuální podobnost a široké tematické štítky, nikoli neomylné popisky každého detailu. Výsledky je vhodné ověřit.

## OCR

1. Nainstaluj Tesseract OCR pro Windows: https://github.com/UB-Mannheim/tesseract/wiki
2. Při instalaci přidej jazyk Czech (`ces`) a English (`eng`).
3. Spusť `INSTALL_OCR.bat`.
4. V aplikaci vyber fotografie a klikni na **OCR**. Rozpoznaný text se uloží do lokální databáze a lze jej hledat textovým hledáním.

## Sestavení samostatného EXE

Na Windows 10/11 x64 s Pythonem 3.12 spusť `BUILD_WINDOWS.bat`. PyInstaller vytvoří složku:

`dist\MediaLupa\MediaLupa.exe`

Kopíruj celou složku `dist\MediaLupa`, ne pouze samotný EXE soubor. AI runtime (PyTorch + Transformers) může výsledný balíček výrazně zvětšit. Model CLIP se i tak stáhne při prvním použití.

GitHub Actions workflow **Build MediaLupa for Windows** lze spustit ručně v záložce Actions nebo vytvořením tagu `v*`. Výsledkem bude artefakt `MediaLupa-Windows-x64`.

## Umístění dat

Databáze, náhledy a cache aplikace jsou oddělené od zdrojových fotografií. Standardně:

`%LOCALAPPDATA%\MediaLupa\MediaLupa\`

Přesnou cestu ukazuje stránka **Nastavení**.

## Omezení této první Windows edice

- Přímé OAuth připojení k webovým účtům Google Photos, OneDrive a Dropbox zatím není součástí této verze. Používají se jejich synchronizované složky dostupné ve Windows Průzkumníku.
- AI indexuje fotografie a reprezentativní snímek videa; nejde o plnohodnotnou časovou analýzu každé sekundy videa.
- OCR vyžaduje samostatnou instalaci Tesseract OCR.
- Detekce vizuálně podobných fotografií je dostupná v sekci Duplicity. Používá 64bitový průměrný hash (aHash) a Hammingovu vzdálenost; nejde o důkaz, že dvě fotografie zachycují totožnou scénu. Automatické přesouvání do kategorií není zapnuté, aby nedošlo k nechtěným změnám originálů.
- HEIC/HEIF závisí na dekodérech Pillow dostupných v daném prostředí.

## Výkon a index podobnosti

Vyhledávání vizuálně podobných snímků používá BK-tree nad Hammingovou metrikou místo úplného porovnání každé dvojice. U rozsáhlých knihoven to typicky výrazně snižuje počet porovnání. Přesný čas závisí na rozložení hashů a zvoleném prahu.

## Bezpečnost a soukromí

MediaLupa pracuje s oprávněními aktuálního uživatele Windows. Nepokouší se obcházet přístupová práva ani získávat přihlašovací údaje. Výchozí operace jsou pouze čtení a indexace; s originály nemanipuluje.
