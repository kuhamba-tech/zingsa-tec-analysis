from zgiis.scientific_rag.chunk import chunk_document
from zgiis.scientific_rag.extract import ExtractedDocument, ExtractedPage


def test_chunk_document_keeps_page_refs():
    doc = ExtractedDocument(
        pages=[
            ExtractedPage(page=1, text="Introduction\n\nTEC over southern Africa rises after sunrise."),
            ExtractedPage(page=2, text="Methods\n\nQuiet-day baselines must use local-time matched samples."),
        ]
    )
    chunks = chunk_document(doc, max_chars=120, overlap=20)
    assert chunks
    assert all(c.text.strip() for c in chunks)
    assert chunks[0].page_start == 1


def test_folder_id_parses_drive_url():
    import os
    from zgiis.scientific_rag import config

    os.environ["GOOGLE_DRIVE_FOLDER_ID"] = "https://drive.google.com/drive/folders/abc123XYZ?usp=sharing"
    assert config.folder_id() == "abc123XYZ"
