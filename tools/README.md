# Making a recipe pack from a PDF cookbook

    pdftotext -bbox-layout -f FIRST -l LAST book.pdf bbox.html
    python3 -I tools/extract.py bbox.html raw.json
    python3 tools/build_pack.py raw.json private/recipes-pack.json "Book name"

`extract.py` numbers pages from 12 (this cookbook's first recipe page); change the `enumerate` start for another book.
`build_pack.py` prints how many recipes agree with the printed calories and lists unmatched ingredients. Add missing ones to `catalogue.py`.
Never commit a pack: `private/` is ignored because book content must stay out of this public repo.
