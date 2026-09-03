# Discharge sheet formats: what the app has to read

Research note, 2026-09-02. For building synthetic demo sheets and the parse schema.

## 1. Hong Kong (Hospital Authority style)

### The document itself: "Discharge Summary"

The Hong Kong Private Hospitals Association publishes a sample discharge summary form
(Appendix 3 of its Code of Practice). Public hospital summaries follow the same skeleton.
It is one page, in English, with these fields in this order:

| Field | What goes there |
| --- | --- |
| Patient label box (top left) | Name, HKID or hospital number, sex, age, ward. Usually a printed sticker. |
| Attending Doctor(s) | Names |
| Admission Date / Discharge Date | Dates |
| Discharge to | Home / Other Hospital / Other |
| Principal Diagnosis | "Diagnosis responsible for patient's admission" |
| Secondary Diagnosis | "All conditions that affect treatment or length of stay" |
| History, Essential Findings | Short clinical narrative, abbreviations, lab values |
| Principal Procedure(s) & Investigations | e.g. ECG, CXR, blood tests, any operation |
| Treatment and Outcome | What was done and how the patient responded |
| Discharge Medication(s) & Follow-up Plan | Drug list with dose and frequency, plus follow-up clinic and timing |
| Allergies | Free text |
| Doctor's Name / Signature | |

Key facts for the app:

- **English, dense, abbreviated.** "HT", "DM", "IHD", "BP 165/95", "T2DM on OHA", "FU SOPD 2/52".
  The Cantonese-speaking parent cannot read any of it. This is the stage moment.
- **Diet is usually not on this document.** If it appears, it is inside "Treatment and
  Outcome" or the follow-up plan as "low salt diet", "DM diet", or "dietitian referral".
  Design for it being absent.
- **Medicines are listed as printed.** Drug name, strength, dose, frequency, sometimes
  duration. The app transcribes these, never interprets them.

### How sure are we about the public-hospital look?

The HKPHA form above is a private-hospital association template, so it is the field set,
not the exact look. Hospital Authority (public) summaries are printed from the hospital
computer system: A4, English, hospital header, patient particulars, the same information
blocks. No real HA printout is published online (they carry personal data), so the exact
layout is **unverified**. Verify by asking a Hong Kong friend for a redacted photo, or by
looking at HA Go, which shows the 出院摘要 electronically.

### What HA itself says the patient walks out with (verified)

The Hong Kong West Cluster discharge checklist (Queen Mary Hospital, June 2022, bilingual)
lists the hospital documents a patient should have on leaving:

- 出院紙 discharge summary
- 覆診紙 appointment slip
- 繳費單 payment slip
- 病假紙 sick leave certificate
- 抽血紙 blood test slip
- 治療處方 treatment sheet
- plus the medicines themselves

And the things the hospital expects the patient to understand before leaving, which map
one-to-one onto the app's cards:

- types of medicines and dosage
- post-discharge care skills
- signals of condition change (the red flags)
- hospital contact information
- follow-up arrangement
- foods to avoid (飲食禁忌)
- advice on activities and sports

So "foods to avoid" is an item HA expects to be communicated at discharge, even when it is
not printed on the summary itself. Source: https://www8.ha.org.hk/QMH/patient_and_visitor/inpatient_information/docs/discharge_checklist.pdf

### The other papers the family carries out

From the Hospital Authority discharge procedure (Kwai Chung Hospital admission and
discharge booklet, revised December 2025) and the HA Smart Patient site:

- **Follow-up card / appointment slip** issued by the ward nurse: clinic, date, time.
- **Prescription**, stamped at the Shroff (cashier) office, then presented at the hospital
  pharmacy to collect the discharge medicines.
- **Drug labels** on each medicine bag: Chinese and English drug name, dose, frequency,
  warnings. These are the only medication text most families can read.
- **Sick leave certificate** if needed.
- HA Go (the HA patient app) can show the discharge summary, lab memo, medication records
  and referral letters electronically.

HA's own discharge guidance tells patients to make sure they "know when and how to take
medication, the dosage and how to store the medicine", to confirm the follow-up date, and to
go to A&E if their condition worsens. That the system prints this is evidence families
routinely leave without knowing it.

## 2. Mainland China (出院记录 / 出院小结)

### Required structure

The national standard 《病历书写基本规范》(卫医政发〔2010〕11号, in force since 2010-03-01)
requires the 出院记录 to be completed within 24 hours of discharge and to contain, in order:

1. Header: 姓名、性别、年龄、科室、床号、住院号, sometimes 职业
2. 入院日期
3. 出院日期
4. 入院情况 (condition on admission, chief complaint, key findings)
5. 入院诊断
6. 诊疗经过 (course in hospital: tests, treatment, response)
7. 出院诊断
8. 出院情况 (condition at discharge)
9. 出院医嘱 (discharge orders)
10. 医师签名

The 出院医嘱 section is where the family lives. Hospital guidance splits it into four
kinds of instruction: 饮食及营养指导, 生活方式指导, 出院用药指导, 随访指导. Typical
numbered lines on a 三高-type discharge:

1. 饮食: 低盐低脂饮食 / 糖尿病饮食 / 清淡饮食, often with 戒烟限酒
2. 用药: each drug with 规格、用量、频次, e.g. 苯磺酸氨氯地平片 5mg 每日一次
3. 监测: 监测血压 / 监测血糖 and what to record
4. 复诊: X 周后 心内科/内分泌科 门诊复诊, 复查 which tests
5. 注意事项 / 不适随诊: warning symptoms that mean return to hospital immediately

Key facts for the app:

- **Chinese, but jargon and abbreviations.** 冠心病, 不稳定型心绞痛, 2型糖尿病, 高脂血症,
  BID/TID/QD sometimes used for frequency.
- **A diet line is near-universal on 三高 admissions** (cardiology, endocrinology,
  neurology). Often boilerplate that nobody reads. Absent or 普食 on unrelated admissions.
- **Formats vary by hospital**, from a printed A4 with a table for medicines to a dense
  paragraph. The electronic record standard (WS/T 500.49 出院记录) fixes the data elements
  but not the visual layout.

## 3. What to look at (10 minutes each)

- **Mainland layouts:** Baidu image search "出院小结" and "出院记录 模板". Look at how
  出院医嘱 is numbered, where the medicine table sits, and how much is handwritten or stamped.
- **Hong Kong layout:** the HKPHA sample form (link below). Public hospital versions add a
  hospital header and a patient sticker, otherwise the same fields.
- **Hong Kong drug labels:** search "醫管局 藥物標籤" to see the bilingual bag label the
  parent actually reads.

## 4. The parse schema the app should produce

Both sheets collapse into the same structure, which is why one engine works:

```
sheet_type:        "hk_en" | "cn_zh" | "unknown"
diagnoses:         [text]                 (shown as printed, never explained as a verdict)
medications:       [{ name, strength, dose, frequency, duration?, source_line }]
follow_up:         [{ clinic, when, tests?, source_line }]
red_flags:         [{ symptom, action, source_line }]   (shown and spoken FIRST)
diet_line:         { raw, type: 低盐|低脂|糖尿病饮食|清淡|other|none, source_line }
activity_line:     { raw, source_line } | none
unreadable:        [region descriptions]  (app says "I could not read this part")
```

Every card carries `source_line` so the spoken sentence can point at the exact line on the
page. `unknown` sheet type and `unreadable` regions are first-class outputs, not errors.

## 5. Synthetic sheets to build for the demo

All fictional. Fictional hospital names, fictional patient with a placeholder name, dates in
2026. Same clinical story on all three so the app can be shown reading both formats.

**Case:** 72-year-old woman, admitted for poorly controlled hypertension with newly found
type 2 diabetes, 4-day stay, discharged home. Three medicines, a diet line, follow-up in two
weeks, three warning signs.

1. **`sheet_hk_en.pdf`**: HKPHA layout, English, abbreviations, one page.
2. **`sheet_cn_zh.pdf`**: 出院记录 layout, Chinese, numbered 出院医嘱, one page.
3. **`sheet_cn_zh_photo.jpg`**: sheet 2 photographed at an angle on a kitchen table, slight
   blur, a thumb in the corner. The robustness demo.

Optional fourth: a sheet with **no diet line** and a specialized instruction (低蛋白饮食) to
demo the refusal path live.

## Sources

- HKPHA sample discharge summary form: https://www.privatehospitals.org.hk/doc/Appendix%203%20-%20Sample%20Discharge%20Summary.pdf
- HKPHA Code of Practice for Doctors (2020): https://www.privatehospitals.org.hk/doc/HKPHA%20Code%20of%20Practice%20for%20Doctors_Revised%202020.pdf
- Kwai Chung Hospital admission and discharge booklet (Dec 2025): https://www3.ha.org.hk/kch/doc/Admission%20and%20discharge%20booklet.pdf
- HA Smart Patient, preparation for admission and discharge: https://www.smartpatient.ha.org.hk/en/smart-patient-web/theme-based-module/smart-elder/medical-appointment-hospital-admission-and-discharge/preparation-for-admission-and-discharge
- HA Go launch notice (record types viewable): https://www.info.gov.hk/gia/general/201912/12/P2019121200327.htm
- 病历书写基本规范 (2010) news notice: https://www.chinanews.com.cn/jk/news/2010/02-04/2110514.shtml
- 病历书写基本规范 full text (hospital copy): https://www.zqts.com/info/1491/250271.htm
- 出院记录 overview: https://baike.baidu.com/item/%E5%87%BA%E9%99%A2%E8%AE%B0%E5%BD%95/8467046
- Electronic record standard, 出院记录 data elements (WS/T 500.49): https://www.gdhealth.net.cn/uploadfile/2016/0809/20160809044126261.pdf
