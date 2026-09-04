# What Hong Kong patients are actually given at discharge

Everything below is from public Hospital Authority material or peer-reviewed research. No patient
data was sought or used. Copies of the two source documents are in `docs/reference/`.

This file exists because the app had, until now, only ever been tested on discharge sheets **we
wrote ourselves**. That is still true of the fixtures. What changed is that we can now check our
design against what the HA itself says a discharge is, instead of against our own assumptions.

---

## 1. The patient leaves with a stack of paper, not one sheet

The Hong Kong West Cluster (Queen Mary and its sister hospitals) hands out a bilingual
**出院清單 / HKWC Discharge Checklist** (PR&E, June 2022). Under 「醫院文件 Hospital Documents」 it
tells the patient to make sure they are carrying:

| Chinese | English |
| --- | --- |
| 出院紙 | Discharge summary |
| 覆診紙 | Appointment slip |
| 繳費單 | Payment slip |
| 病假紙 | Sick leave certificate |
| 抽血紙 | Blood test slip |
| 治療處方 | Treatment sheet |

**Two things follow directly.**

First, the earlier worry — that HK patients may not receive a discharge summary at all — is
narrower than it looked. HKWC's own patient-facing checklist assumes 出院紙 is in the patient's
hands when they walk out. The HK$230 medical-report fee applies to requesting records *later*, not
to the discharge paperwork itself.

Second, **the multi-page capture in the v2 design is not a nice-to-have.** The follow-up date is on
the 覆診紙, the medicines are on the 出院紙, the blood test is on the 抽血紙. A tool that reads one
page reads a third of the discharge. Kevin's six-page ceiling with 加一頁 is the correct shape, and
the ceiling has to refuse loudly rather than truncate, because a truncated medical document is a
missing medicine.

---

## 2. The HA's own list of what a patient must understand is almost exactly our card set

The right-hand column of the same checklist, 「出院後注意事項 Points to Note After Discharge」,
asks 「已了解清楚？ What should you pay attention to?」 and lists:

| HA's checklist | Our card |
| --- | --- |
| 藥物種類及服用量 · Types of medicines & dosage | `medicine` |
| 護理技巧 · Post-discharge care | (not extracted) |
| **病情變化徵狀 · Signals of condition change** | **`warning`** |
| 醫院聯絡方法 · Contact information of hospital | `hospitalContact` |
| 覆診安排 · Follow-up arrangement | `followUp` |
| 飲食禁忌 · Foods to avoid | `diet` |
| 活動 / 運動建議 · Advice on activities / sports | `activity` |

Six of the seven are fields we already extract, under headings we did not copy from anywhere. We
arrived at them from `discharge_sheet_formats.md` research and the constitution's "warning signs
first" rule; the HA arrived at them from clinical practice. That convergence is worth saying out
loud in the pitch — it is external validation that the schema is aimed at the right things.

The one we do not extract is 護理技巧 (wound care, catheter care, and so on). That is a deliberate
omission and should stay one: it is procedural instruction, and reading it aloud edges toward
telling someone how to perform care rather than telling them what the page says.

---

## 3. The real painpoint, in the HA's own numbers

In 2017 the Hospital Authority built the **post-discharge information summary (PDIS)** — an EHR
tool that prints a personalised discharge form. Per the published implementation study
(Kwok et al., *Implementation Science Communications*, PMC12046763), it carries:

- a **salient medication reminder**, covering "80% of the prescribed discharge medications
  alongside 235 most relevant and important side effects and **warning signal items** adapted to
  local older adult patients"
- an online drug database
- future follow-up appointment information

and it is printed "translated into Chinese and displayed in **larger font sizes**" for readability.

So the paper our app photographs is a real, structured, HA-designed document. Good. But the same
study found how it is actually delivered:

> only **78% of nurses consistently printing** PDIS forms and **57% consistently explaining** the
> content

and, describing the workflow:

> "print the written PDIS form and explain the content … **Teach-back is not required.**"

**That is the product in one line.** Roughly two in five patients are handed the paper with no
explanation at all — and even the ones who get an explanation are never checked for understanding,
because teach-back is not part of the process.

The study also names, among the barriers to PDIS working: **lack of English versions**, and
insufficient drug database coverage.

---

## 4. What this changes about how we describe the app

Three claims we can now make with a citation behind them, and one we must stop making.

**Can say:**

1. *We are not replacing the nurse's explanation. We are what happens when it didn't occur* — which
   the HA's own implementation data puts at about 43% of discharges.
2. *We add the teach-back the workflow explicitly does not require.* Kevin's 明唔明？ →
   再講一次 / 明白 loop is teach-back, one piece at a time. That is not a UI flourish; it is the
   missing step in the documented process.
3. *We answer the "no English version" gap* — and go further, since Cantonese is the language most
   of these patients actually think in, and the printed form is written Chinese.

**Must stop saying:** anything that implies the app has been validated on real discharge paper. It
has not. Every fixture in `fixtures/sheets/` and `fixtures/stress/` was authored by us. The
schema now has third-party support; the *reading accuracy* still has none.

---

## 5. Still outstanding

A real, filled-in discharge summary. It does not exist publicly and should not — it is patient
data. The realistic routes, in order of preference:

1. A family member's own old discharge paperwork, with their permission, used once and not stored.
2. A HK pharmacist, nurse or medical student willing to show a blank or fully de-identified PDIS
   printout.
3. Photographing the blank forms available at a hospital patient resource centre.

One real sheet is worth more than any further tuning against our own fixtures, because the failure
mode we cannot see from here is the one where a real form's layout breaks an assumption we did not
know we had made.

---

## Sources

- [HKWC Discharge Checklist (June 2022)](https://www8.ha.org.hk/QMH/patient_and_visitor/inpatient_information/docs/discharge_checklist.pdf) — copy at `docs/reference/HKWC-discharge-checklist-2022-06.pdf`
- [KCH Admission and Discharge Booklet (Dec 2025)](https://www3.ha.org.hk/kch/doc/Admission%20and%20discharge%20booklet.pdf) — copy at `docs/reference/KCH-admission-discharge-booklet-2025-12.pdf`
- [Enhancing implementation of ICT for post-discharge care among hospitalized older adult patients (PMC12046763)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12046763/)
- [HA Smart Patient Website](https://www.smartpatient.ha.org.hk/en/smart-patient-web)
