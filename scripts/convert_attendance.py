"""
convert_attendance.py
---------------------
Converts a raw biometric attendance Excel (wide format) into a
normalized row-per-employee-per-day Excel with a Summary sheet.

INPUT  : raw_attendance.xlsx  (place in same folder as this script)
OUTPUT : attendance_normalized.xlsx  (written to same folder)

Usage:
    pip install openpyxl
    python convert_attendance.py
    # or specify paths:
    python convert_attendance.py raw_attendance.xlsx attendance_normalized.xlsx
"""

import sys
import os
import re
from datetime import datetime, timedelta
from openpyxl import load_workbook, Workbook
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

# ── Colour fills ──────────────────────────────────────────────────────────────
FILL_PRESENT    = PatternFill("solid", fgColor="C6EFCE")   # green
FILL_ABSENT     = PatternFill("solid", fgColor="FFC7CE")   # red
FILL_WEEKOFF    = PatternFill("solid", fgColor="FFEB9C")   # yellow
FILL_NOTMARKED  = PatternFill("solid", fgColor="D9D9D9")   # grey
FILL_INCOMPLETE = PatternFill("solid", fgColor="FCE4D6")   # orange
FILL_HEADER     = PatternFill("solid", fgColor="1F3864")   # dark navy
FILL_SUMMARY_HDR= PatternFill("solid", fgColor="2E75B6")   # blue

FONT_HDR   = Font(bold=True, color="FFFFFF", size=11)
FONT_DATA  = Font(size=10)

THIN = Side(style="thin", color="D9D9D9")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

STATUS_FILL = {
    "Present":    FILL_PRESENT,
    "Absent":     FILL_ABSENT,
    "Week Off":   FILL_WEEKOFF,
    "Not Marked": FILL_NOTMARKED,
    "Incomplete": FILL_INCOMPLETE,
}

MONTHS = {
    "jan":1,"feb":2,"mar":3,"apr":4,"may":5,"jun":6,
    "jul":7,"aug":8,"sep":9,"oct":10,"nov":11,"dec":12,
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_header_date(header: str, year: int = None) -> datetime | None:
    """Parse column headers like '01-May', '1-May', '01-May-2024'."""
    if not header:
        return None
    header = str(header).strip()
    # already has year
    m = re.match(r"(\d{1,2})[/-]([A-Za-z]+)[/-](\d{4})", header)
    if m:
        day, mon, yr = int(m.group(1)), m.group(2).lower()[:3], int(m.group(3))
        if mon in MONTHS:
            return datetime(yr, MONTHS[mon], day)
    # no year — DD-Mon
    m = re.match(r"(\d{1,2})[/-]([A-Za-z]+)", header)
    if m:
        day, mon = int(m.group(1)), m.group(2).lower()[:3]
        if mon in MONTHS:
            yr = year or datetime.today().year
            return datetime(yr, MONTHS[mon], day)
    return None


def fmt_date(dt: datetime) -> str:
    return dt.strftime("%d-%b-%Y")   # e.g. 01-May-2024


def parse_time(t: str) -> datetime | None:
    """Parse HH:MM:SS or HH:MM strings into a datetime (date part ignored)."""
    if not t:
        return None
    t = str(t).strip()
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(t, fmt)
        except ValueError:
            pass
    return None


def calc_hours(cin: str, cout: str) -> str:
    """Return HH:MM:SS working hours, 'Incomplete' if checkout missing/00:00."""
    if not cin:
        return "0:00:00"
    if not cout or cout in ("00:00", "00:00:00", "0:00"):
        return "Incomplete"
    t_in  = parse_time(cin)
    t_out = parse_time(cout)
    if not t_in or not t_out:
        return "Incomplete"
    diff = t_out - t_in
    if diff.total_seconds() < 0:
        diff += timedelta(hours=24)
    total = int(diff.total_seconds())
    h, rem = divmod(total, 3600)
    m, s   = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}"


def hours_to_float(h_str: str) -> float:
    """Convert 'H:MM:SS' to float hours. Returns 0 for Incomplete/invalid."""
    if not h_str or h_str in ("Incomplete", "0:00:00"):
        return 0.0
    parts = h_str.split(":")
    try:
        return int(parts[0]) + int(parts[1])/60 + int(parts[2])/3600
    except Exception:
        return 0.0


def cell_value(cell) -> str:
    """Get normalised string value from an openpyxl cell."""
    v = cell.value
    if v is None:
        return ""
    return str(v).strip()


def parse_attendance_cell(raw: str):
    """
    Parse a raw cell string that may contain:
      - Two lines: "10:26:55\n17:50:13"  →  (cin, cout, "Present")
      - One time:  "10:26:55"            →  (cin, "",   "Present")
      - "WO"                             →  ("",  "",   "Week Off")
      - "A"                              →  ("",  "",   "Absent")
      - ""                               →  ("",  "",   "Not Marked")

    openpyxl sometimes joins multi-line cell content with '\n'.
    """
    s = raw.strip()
    if not s:
        return "", "", "Not Marked"

    upper = s.upper()
    if upper == "WO":
        return "", "", "Week Off"
    if upper == "A":
        return "", "", "Absent"

    # Split on newline (multi-line cell), or on common separators
    parts = [p.strip() for p in re.split(r"[\n\r]+", s) if p.strip()]

    # Filter out anything that doesn't look like a time
    time_parts = [p for p in parts if re.match(r"^\d{1,2}:\d{2}", p)]

    if not time_parts:
        # Could be a date-like value openpyxl converted; treat as Not Marked
        return "", "", "Not Marked"

    cin  = time_parts[0] if len(time_parts) >= 1 else ""
    cout = time_parts[1] if len(time_parts) >= 2 else ""

    # Treat 00:00 / 00:00:00 checkout as incomplete
    if cout in ("00:00", "00:00:00", "0:00"):
        cout = ""

    status = "Present"
    return cin, cout, status


def style_cell(cell, fill=None, font=None, bold=False, align="left"):
    cell.border = BORDER
    cell.alignment = Alignment(horizontal=align, vertical="center", wrap_text=False)
    if fill:
        cell.fill = fill
    if font:
        cell.font = font
    elif bold:
        cell.font = Font(bold=True, size=10)
    else:
        cell.font = FONT_DATA


# ── Main conversion ───────────────────────────────────────────────────────────

def convert(input_path: str, output_path: str):
    print(f"Reading  : {input_path}")
    wb_in = load_workbook(input_path, data_only=True)
    ws_in = wb_in.active

    rows = list(ws_in.iter_rows(values_only=False))
    if len(rows) < 2:
        print("ERROR: Input sheet has fewer than 2 rows.")
        return

    # ── Detect header row ────────────────────────────────────────────────────
    # Row 1 is assumed to be: EmpCode | EmpName | Department | 01-May | 02-May ...
    header_row = rows[0]
    date_cols  = {}   # col_index → datetime

    # Try to detect year from any header that has it
    detected_year = None
    for cell in header_row[3:]:
        v = cell_value(cell)
        m = re.search(r"\d{4}", v)
        if m:
            detected_year = int(m.group())
            break

    for idx, cell in enumerate(header_row):
        if idx < 3:
            continue
        v = cell_value(cell)
        dt = parse_header_date(v, detected_year)
        if dt:
            date_cols[idx] = dt

    if not date_cols:
        print("ERROR: No date columns detected in header row. "
              "Ensure columns D onwards have headers like '01-May' or '01-May-2024'.")
        return

    print(f"Detected {len(date_cols)} date columns "
          f"({fmt_date(min(date_cols.values()))} → {fmt_date(max(date_cols.values()))})")

    # ── Parse data rows ──────────────────────────────────────────────────────
    records = []   # list of dicts
    seen    = set()  # (emp_code, date_str) for duplicate check

    for row in rows[1:]:
        emp_code = cell_value(row[0])
        emp_name = cell_value(row[1])
        dept     = cell_value(row[2])

        if not emp_code or not emp_name:
            continue   # skip blank / header-continuation rows

        for col_idx, dt in sorted(date_cols.items()):
            if col_idx >= len(row):
                raw = ""
            else:
                raw = cell_value(row[col_idx])

            cin, cout, status = parse_attendance_cell(raw)
            working_hrs = calc_hours(cin, cout) if status == "Present" else "0:00:00"

            date_str = fmt_date(dt)
            key = (emp_code, date_str)
            if key in seen:
                continue   # skip duplicates
            seen.add(key)

            records.append({
                "emp_code":    emp_code,
                "emp_name":    emp_name,
                "dept":        dept,
                "date":        date_str,
                "date_dt":     dt,
                "cin":         cin,
                "cout":        cout,
                "status":      status,
                "working_hrs": working_hrs,
            })

    # Sort by emp_code then date
    records.sort(key=lambda r: (str(r["emp_code"]).zfill(10), r["date_dt"]))
    print(f"Total records: {len(records)}")

    # ── Build output workbook ────────────────────────────────────────────────
    wb_out = Workbook()

    # ── Sheet 1: Normalized Attendance ──────────────────────────────────────
    ws = wb_out.active
    ws.title = "Attendance"
    ws.freeze_panes = "A2"

    headers = ["Emp Code", "EMP Name", "Department", "Date",
               "Check-In Time", "Check-Out Time", "Status", "Working Hours"]
    col_widths = [12, 28, 24, 16, 16, 16, 14, 16]

    for c, (h, w) in enumerate(zip(headers, col_widths), start=1):
        cell = ws.cell(row=1, column=c, value=h)
        style_cell(cell, fill=FILL_HEADER, font=FONT_HDR, align="center")
        ws.column_dimensions[get_column_letter(c)].width = w

    ws.row_dimensions[1].height = 22

    # Data validation for Status column (col 7)
    dv = DataValidation(
        type="list",
        formula1='"Present,Absent,Week Off,Not Marked,Incomplete"',
        allow_blank=False,
        showErrorMessage=True,
        errorTitle="Invalid Status",
        error="Status must be one of: Present, Absent, Week Off, Not Marked, Incomplete",
    )
    ws.add_data_validation(dv)

    for r_idx, rec in enumerate(records, start=2):
        row_data = [
            rec["emp_code"],
            rec["emp_name"],
            rec["dept"],
            rec["date"],
            rec["cin"],
            rec["cout"],
            rec["status"],
            rec["working_hrs"],
        ]
        status_fill = STATUS_FILL.get(rec["status"], FILL_NOTMARKED)
        for c_idx, val in enumerate(row_data, start=1):
            cell = ws.cell(row=r_idx, column=c_idx, value=val)
            # Highlight entire row based on status
            style_cell(cell, fill=status_fill)
            if c_idx in (5, 6, 8):   # time / hours columns → center
                cell.alignment = Alignment(horizontal="center", vertical="center")
        # Attach data validation to status cell
        dv.add(ws.cell(row=r_idx, column=7))

    ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}1"

    # ── Sheet 2: Summary ─────────────────────────────────────────────────────
    ws2 = wb_out.create_sheet("Summary")
    ws2.freeze_panes = "A2"

    s_headers = [
        "Emp Code", "EMP Name", "Department",
        "Total Present", "Total Absent", "Total Week Off", "Not Marked",
        "Total Working Hours", "Avg Daily Hours", "Attendance Rate (%)",
    ]
    s_widths = [12, 28, 24, 14, 14, 14, 12, 20, 16, 20]

    for c, (h, w) in enumerate(zip(s_headers, s_widths), start=1):
        cell = ws2.cell(row=1, column=c, value=h)
        style_cell(cell, fill=FILL_SUMMARY_HDR, font=FONT_HDR, align="center")
        ws2.column_dimensions[get_column_letter(c)].width = w
    ws2.row_dimensions[1].height = 22

    # Aggregate per employee
    from collections import defaultdict
    emp_agg = defaultdict(lambda: {
        "name": "", "dept": "",
        "present": 0, "absent": 0, "weekoff": 0, "notmarked": 0,
        "total_hrs": 0.0,
    })

    for rec in records:
        agg = emp_agg[rec["emp_code"]]
        agg["name"] = rec["emp_name"]
        agg["dept"] = rec["dept"]
        s = rec["status"]
        if s == "Present":
            agg["present"] += 1
            agg["total_hrs"] += hours_to_float(rec["working_hrs"])
        elif s == "Absent":
            agg["absent"] += 1
        elif s == "Week Off":
            agg["weekoff"] += 1
        else:
            agg["notmarked"] += 1

    sorted_emp = sorted(emp_agg.items(), key=lambda x: str(x[0]).zfill(10))

    ALT_FILL = PatternFill("solid", fgColor="EBF3FB")

    for r_idx, (emp_code, agg) in enumerate(sorted_emp, start=2):
        present    = agg["present"]
        absent     = agg["absent"]
        weekoff    = agg["weekoff"]
        notmarked  = agg["notmarked"]
        total_hrs  = agg["total_hrs"]
        workdays   = present + absent + notmarked   # excludes week-off
        att_rate   = round((present / workdays * 100), 1) if workdays > 0 else 0.0
        avg_hrs    = round(total_hrs / present, 2)  if present > 0 else 0.0

        # Format total hours as H:MM
        th = int(total_hrs)
        tm = int((total_hrs - th) * 60)
        total_hrs_str = f"{th}:{tm:02d}"

        row_fill = ALT_FILL if r_idx % 2 == 0 else None
        row_data = [
            emp_code, agg["name"], agg["dept"],
            present, absent, weekoff, notmarked,
            total_hrs_str, f"{avg_hrs:.2f}", f"{att_rate:.1f}%",
        ]
        for c_idx, val in enumerate(row_data, start=1):
            cell = ws2.cell(row=r_idx, column=c_idx, value=val)
            style_cell(cell, fill=row_fill)
            if c_idx >= 4:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            # Colour-code attendance rate
            if c_idx == 10:
                rate = att_rate
                if rate >= 90:
                    cell.fill = FILL_PRESENT
                elif rate >= 75:
                    cell.fill = FILL_WEEKOFF
                else:
                    cell.fill = FILL_ABSENT

    ws2.auto_filter.ref = f"A1:{get_column_letter(len(s_headers))}1"

    # ── Save ─────────────────────────────────────────────────────────────────
    wb_out.save(output_path)
    print(f"Output   : {output_path}")
    print(f"Rows     : {len(records)} (Attendance) + {len(sorted_emp)} (Summary)")
    print("Done ✓")


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    base = os.path.dirname(os.path.abspath(__file__))
    inp  = sys.argv[1] if len(sys.argv) > 1 else os.path.join(base, "raw_attendance.xlsx")
    out  = sys.argv[2] if len(sys.argv) > 2 else os.path.join(base, "attendance_normalized.xlsx")

    if not os.path.exists(inp):
        print(f"ERROR: Input file not found: {inp}")
        print("Place your raw Excel as 'raw_attendance.xlsx' in the scripts/ folder,")
        print("or pass the path as the first argument.")
        sys.exit(1)

    convert(inp, out)
