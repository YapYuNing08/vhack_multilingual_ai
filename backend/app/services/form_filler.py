"""
form_filler.py
--------------
Fills the Borang STR PDF with user-provided data.
Uses pypdf to write into fillable form fields.
Falls back to reportlab overlay if the PDF has no fillable fields.
"""

import os
import io
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, BooleanObject, ArrayObject, DecodedStreamObject

# Path to the blank STR form — place your PDF here
STR_FORM_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "forms", "str_borang.pdf")


def get_form_fields(pdf_path: str) -> list[str]:
    """Return list of fillable field names in the PDF."""
    try:
        reader = PdfReader(pdf_path)
        fields = reader.get_fields()
        return list(fields.keys()) if fields else []
    except Exception:
        return []


def fill_str_form(user_data: dict) -> bytes:
    """
    Fill the STR Borang PDF with user data and return the filled PDF as bytes.

    user_data keys:
        nama_penuh          - Full name
        no_mykad            - IC number
        no_telefon          - Phone number
        emel                - Email
        pendapatan_bulanan  - Monthly income (RM)
        status_perkahwinan  - Marital status
    """
    if not os.path.exists(STR_FORM_PATH):
        # Generate a clean PDF from scratch if the form file doesn't exist yet
        return _generate_pdf_from_scratch(user_data)

    try:
        reader = PdfReader(STR_FORM_PATH)
        fields = reader.get_fields()

        if fields:
            # ── Fillable PDF: write directly into form fields ──────────────
            return _fill_fillable_pdf(reader, user_data)
        else:
            # ── Non-fillable PDF: overlay text using reportlab ─────────────
            return _fill_with_overlay(STR_FORM_PATH, user_data)

    except Exception as e:
        print(f"[FormFiller] Error filling PDF: {e} — generating from scratch")
        return _generate_pdf_from_scratch(user_data)


def _fill_fillable_pdf(reader: PdfReader, user_data: dict) -> bytes:
    """Fill a PDF that has AcroForm fillable fields."""
    writer = PdfWriter()
    writer.append(reader)

    # Map the exact DocFly generated field names to our collected data!
    field_values = {
        "Text-VrA9l326zk": user_data.get("nama_penuh", ""),
        "Text-n53kYRXq1L": user_data.get("no_mykad", ""),
        "Text-noU621NGbI": user_data.get("no_telefon", ""),
        "Text-n0RHb7dlmq": user_data.get("emel", ""),
        "Text-IHSlH_BG5K": str(user_data.get("pendapatan_bulanan", "")),
        "Text-OFk10qSdL5": user_data.get("status_perkahwinan", ""),
    }

    writer.update_page_form_field_values(writer.pages[0], field_values)

    # 🚨 CRITICAL FIX FOR MOBILE PHONES: Force the PDF viewer to draw the text!
    if "/AcroForm" in writer.root_object:
        writer.root_object["/AcroForm"][NameObject("/NeedAppearances")] = BooleanObject(True)

    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def _fill_with_overlay(pdf_path: str, user_data: dict) -> bytes:
    """Overlay text onto a non-fillable PDF using reportlab."""
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from pypdf import PdfReader, PdfWriter

    # Create overlay with user data
    packet = io.BytesIO()
    c = canvas.Canvas(packet, pagesize=A4)
    width, height = A4

    c.setFont("Helvetica", 11)
    c.setFillColorRGB(0, 0, 0)

    # Approximate field positions — adjust Y values to match your form layout
    fields = [
        (user_data.get("nama_penuh", ""),          200, height - 210),
        (user_data.get("no_mykad", ""),             200, height - 255),
        (user_data.get("no_telefon", ""),           200, height - 300),
        (user_data.get("emel", ""),                 200, height - 345),
        (str(user_data.get("pendapatan_bulanan", "")), 200, height - 390),
        (user_data.get("status_perkahwinan", ""),   200, height - 435),
    ]

    for text, x, y in fields:
        c.drawString(x, y, str(text))

    c.save()
    packet.seek(0)

    # Merge overlay onto original
    overlay_reader = PdfReader(packet)
    original_reader = PdfReader(pdf_path)
    writer = PdfWriter()

    original_page = original_reader.pages[0]
    original_page.merge_page(overlay_reader.pages[0])
    writer.add_page(original_page)

    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def _generate_pdf_from_scratch(user_data: dict) -> bytes:
    """
    Generate a clean STR form PDF from scratch using reportlab.
    Used when the blank form PDF hasn't been placed yet.
    """
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.enums import TA_CENTER, TA_LEFT

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=2*cm, leftMargin=2*cm,
        topMargin=2*cm, bottomMargin=2*cm
    )

    styles = getSampleStyleSheet()
    story  = []

    # ── Header ────────────────────────────────────────────────────────────
    title_style = ParagraphStyle(
        'Title', parent=styles['Normal'],
        fontSize=16, fontName='Helvetica-Bold',
        alignment=TA_CENTER, spaceAfter=4,
    )
    sub_style = ParagraphStyle(
        'Sub', parent=styles['Normal'],
        fontSize=11, fontName='Helvetica',
        alignment=TA_CENTER, spaceAfter=2,
    )
    label_style = ParagraphStyle(
        'Label', parent=styles['Normal'],
        fontSize=10, fontName='Helvetica-Bold',
        textColor=colors.HexColor('#1a1a1a'),
    )
    value_style = ParagraphStyle(
        'Value', parent=styles['Normal'],
        fontSize=11, fontName='Helvetica',
        textColor=colors.HexColor('#0d47a1'),
    )
    note_style = ParagraphStyle(
        'Note', parent=styles['Normal'],
        fontSize=8, fontName='Helvetica',
        textColor=colors.grey, alignment=TA_CENTER,
    )

    story.append(Paragraph("KERAJAAN MALAYSIA", title_style))
    story.append(Paragraph("Borang Permohonan", sub_style))
    story.append(Paragraph("Sumbangan Tunai Rahmah (STR)", title_style))
    story.append(Spacer(1, 0.3*cm))
    story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor('#1565c0')))
    story.append(Spacer(1, 0.5*cm))

    # ── Form data table ───────────────────────────────────────────────────
    FIELDS = [
        ("Nama Penuh",                  user_data.get("nama_penuh", "-")),
        ("Nombor Kad Pengenalan (MyKad)",user_data.get("no_mykad", "-")),
        ("Nombor Telefon",              user_data.get("no_telefon", "-")),
        ("E-mel",                       user_data.get("emel", "-")),
        ("Pendapatan Bulanan (RM)",     str(user_data.get("pendapatan_bulanan", "-"))),
        ("Status Perkahwinan",          user_data.get("status_perkahwinan", "-")),
    ]

    table_data = []
    for label, value in FIELDS:
        table_data.append([
            Paragraph(label, label_style),
            Paragraph(str(value), value_style),
        ])

    table = Table(table_data, colWidths=[7*cm, 10*cm])
    table.setStyle(TableStyle([
        ('BACKGROUND',  (0, 0), (0, -1), colors.HexColor('#e3f2fd')),
        ('BACKGROUND',  (1, 0), (1, -1), colors.white),
        ('GRID',        (0, 0), (-1, -1), 0.5, colors.HexColor('#90caf9')),
        ('ROWBACKGROUNDS', (0, 0), (-1, -1), [colors.HexColor('#e3f2fd'), colors.HexColor('#f5f5f5')]),
        ('VALIGN',      (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING',  (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING',(0,0), (-1, -1), 10),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING',(0, 0), (-1, -1), 10),
    ]))

    story.append(table)
    story.append(Spacer(1, 1*cm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#90caf9')))
    story.append(Spacer(1, 0.4*cm))

    # ── Declaration ───────────────────────────────────────────────────────
    decl_style = ParagraphStyle(
        'Decl', parent=styles['Normal'],
        fontSize=9, fontName='Helvetica',
        textColor=colors.HexColor('#333333'),
        leading=14,
    )
    story.append(Paragraph(
        "Saya dengan ini mengakui bahawa maklumat yang diberikan adalah benar dan tepat. "
        "Saya faham bahawa memberikan maklumat palsu adalah satu kesalahan di bawah undang-undang Malaysia.",
        decl_style
    ))
    story.append(Spacer(1, 1.5*cm))

    # ── Signature line ────────────────────────────────────────────────────
    sig_data = [
        ["_______________________________", "_______________"],
        ["Tandatangan Pemohon",            "Tarikh"],
    ]
    sig_table = Table(sig_data, colWidths=[11*cm, 6*cm])
    sig_table.setStyle(TableStyle([
        ('FONTNAME',  (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE',  (0, 0), (-1, -1), 9),
        ('TOPPADDING',(0, 0), (-1, -1), 2),
    ]))
    story.append(sig_table)
    story.append(Spacer(1, 0.8*cm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#bbdefb')))
    story.append(Spacer(1, 0.3*cm))
    story.append(Paragraph(
        "Dokumen ini dijana oleh SilaSpeak — Pembantu Perkhidmatan Awam Digital Malaysia",
        note_style
    ))

    doc.build(story)
    buffer.seek(0)
    return buffer.getvalue()