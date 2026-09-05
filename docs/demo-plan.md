# Run-of-show · the live demo, minute by minute

Written 2026-09-05 against production `5e14240` (early warning cards, 2400 px uploads, the two
demo sheets). Every number below was measured on production with the sheet uploaded exactly as the
phone uploads it. `docs/demo-script.md` carries the pitch; this is the click-list and the timing.

## The two sheets

Print both from the PDFs. Keep them flat, matte, on a plain table, under even light.

| | `demo_en` (read this one live) | `demo_zh_hant` (pre-read, show in 記錄) |
| --- | --- | --- |
| Story | 68F, pneumonia, Harbour View Hospital, English | 76M, heart failure, 港灣醫院, Traditional Chinese |
| Medicines | Amoxicillin-Clavulanate 1g BD after food 5d · Paracetamol 500mg 2 tabs QID PRN 5d · Amlodipine 5mg daily 28d · Simvastatin 20mg nocte 28d | Frusemide 40mg 每朝一次 · Bisoprolol 2.5mg 每日一次 · Spironolactone 25mg 早餐後 · Apixaban 5mg 每日兩次 |
| Stopped | Diclofenac 50mg TDS (must never be scheduled) | Indapamide 2.5mg |
| Warning signs | shortness of breath at rest or lying flat · coughing up blood · chest pain that does not go away after resting | 平臥時氣促或夜間喘醒 · 雙腳水腫明顯加劇 · 胸口痛持續不退 |
| Follow-up | MED SOPD 07-10-2026 10:15 · **fasting** bloods 30-09-2026 08:00 | 內科專科門診 2026-10-14 09:30 · 空腹抽血 2026-10-07 08:00 |
| Diet / activity | low salt, no soy sauce at the table / no heavy lifting 2 weeks | 低鹽 / 室內慢行，兩星期內避免搬重物 |
| Ward phone | Ward 5B 2xxx xxxx | 6B病房 2xxx xxxx |
| Read on production | first red flag spoken **13 s**, all three by 16 s, full sheet **39 s** | first red flag 49 s, full sheet 65 s |

Why English live: the model thinks about four times longer before writing on the Chinese page, and
a minute of waiting on stage is a minute you cannot fill. The Chinese sheet still reads perfectly
(5/5 medicines, stopped drug never scheduled, 3/3 warnings), so it is read **before** you walk up
and shown as the sheet already in 記錄 — which is also the honest picture of the product: a family
keeps several sheets.

## T minus 10 minutes, at the table

1. Phone on **https://mingming.app**. Not a preview URL.
2. Tap 明白，開始 (unlocks audio). Hold the bar once and grant the microphone (the first hold of a
   session is always eaten by the iOS permission sheet).
3. **Read the Chinese sheet now**: 影相 → photograph `demo_zh_hant` → wait the ~65 s → let 明明
   speak the first red flag, then tap through or let it run. It is now the active sheet.
4. Ask one throwaway question (「幾時覆診？」) and wait for the answer. This is the warm-up; the first
   request after minutes of idleness is slower.
5. Ring switch off, volume up, speaker on. Laptop open on the QR slide and the backup video.
6. Do **not** clear 記錄. The Chinese sheet stays as the earlier sheet.

## On stage

| Clock | You do | The phone does | You point at |
| --- | --- | --- | --- |
| 0:00 | Slides 1–3, the pitch (docs/demo-script.md) | idle on 記錄 with the Chinese sheet visible | the earlier sheet: "she already has one sheet in here from last month" |
| 1:10 | Tap 影相, photograph `demo_en`, tap 講俾我聽 | progress screen; 明明 says he is reading | the printed sheet |
| 1:23 | Say nothing. Let it land. | **first red flag spoken at ~13 s**, second and third follow within 3 s, shown in amber | the amber list: "warnings first, before anything else — that is the rule" |
| 1:50 | Let the greeting play | full sheet lands at ~39 s: summary, then the amber bubble asks 明唔明 | the medicine cards, the stopped-drug card, the fasting line |
| 1:55 | Say 「明白」 or tap through | 明明 goes on to the medicines | one card, then the source button: "every card shows the printed line it came from" |
| 2:20 | Hold the bar, ask **「出院後要食咩藥？」** | 7 s, four medicines named, first sentence spoken before the rest is written | the answer lists all four |
| 2:35 | Ask **「有冇其他藥？」** | 7 s, "冇喇" and names the four again, notes Diclofenac was stopped | the conversation remembers the last turn |
| 2:50 | Ask **「Diclofenac 仲使唔使食？」** | 4 s, "唔使喇 … 住院期間已經停咗" | the stopped card: it is never scheduled |
| 3:05 | Ask **「空腹係咩意思？」** | 9 s, explains fasting in plain Cantonese, says the sheet does not say why | a general question, answered as a definition, no advice |
| 3:20 | Ask **「我可唔可以唔食抗生素？」** | **under 1 s**, refuses: 「藥點食、食唔食，張紙冇話得，要問藥劑師」 | the guardrail: no model call, instant, points to a person |
| 3:35 | Ask **「幾時覆診？」** | 4 s, "MED SOPD，2026年10月7號星期三早上10:15，帶埋張紙同藥袋" | 跟進 tab: the appointment and the doses are already there |
| 3:50 | Tap 跟進 | the plan: two appointments, dose counters, the warning signs again | "this is what she keeps; delete-everything is one tap in settings" |
| 4:10 | Close: the ask (docs/demo-script.md) | | the QR slide |

Talk under the phone, not over it. When 明明 is speaking, stop.

## The questions, in order, with what happens

All measured on production against the English demo sheet, warm, in Cantonese. Say them exactly;
each one shows a different thing.

| # | Say | Time | What comes back | What it shows |
| --- | --- | --- | --- | --- |
| 1 | 出院後要食咩藥？ | 7 s | the four medicines, strength, dose and timing | reads the list off the page; first sentence spoken before the rest is written |
| 2 | 有冇其他藥？ | 7 s | 冇喇 — the same four, and Diclofenac was stopped | the conversation remembers the previous turn |
| 3 | Diclofenac 仲使唔使食？ | 4 s | 唔使喇，住院期間已經停咗 | a stopped drug is known and never scheduled |
| 4 | 邊隻藥係夜晚食嘅？ | 5 s | Simvastatin 20mg, one at night, 28 days | a question about one card gets one card |
| 5 | 退燒藥點食？ | 4 s | Paracetamol 500mg, two when feverish, at most four times a day, 5 days | the whole printed instruction, verbatim, PRN included |
| 6 | 有咩情況要即刻返急症室？ | 6 s | the three signs: breathless at rest or lying flat, coughing blood, chest pain that does not ease | warning signs, quoted from the page |
| 7 | 飲食有咩要注意？ | 4 s | low salt, no added salt or soy sauce at the table | the diet line |
| 8 | 空腹係咩意思？ | 9 s | what fasting means, and that the sheet does not say why | a general word explained, no advice |
| 9 | BD 係咩意思？ | 6 s | twice a day, usually morning and evening | an abbreviation explained |
| 10 | 我可唔可以唔食抗生素？ | **under 1 s** | 藥點食、食唔食，張紙冇話得，要問藥劑師 | the guardrail: refused with no model call |
| 11 | 我係咪好嚴重？ | 7 s | 呢個我答你唔到，要問醫生 — then repeats the three warning signs | the boundary: never assesses the person, still tells her what to watch for |
| 12 | 幾時覆診？ | 4 s | MED SOPD, 7 Oct 2026, Wed, 10:15, bring the sheet and the drug bags | the appointment; then tap 跟進 to show it in the plan |

For the stage pick six: **1, 2, 3, 8, 10, 12** in that order (list → memory → stopped drug →
a word explained → the refusal → the appointment). If a judge wants more, 6 and 11 are the two
that show the safety line best. Keep 4, 5, 7, 9 for Q&A.

Do not ask on stage: anything about a real person, a dose change ("can I take two"), whether
something is normal, or "what is wrong with me" — the first three are refused on purpose and the
last is a boundary answer; all correct, none impressive.

## If something goes wrong

- **Camera read fails or takes over a minute**: tap 上載相片 and pick the `demo_en` PNG from the
  photo library (put it there tonight). Same read, same timings. If that fails too: 用示範紙 gives
  the bundled English sample; the questions above all work on it except the Diclofenac one.
- **First question is slow (>15 s)**: you skipped the warm-up. Say "first call of the day" and ask
  the next one; the second is 5 s.
- **No voice**: the MiniMax balance is zero or the phone is muted. Text still arrives; read it
  aloud yourself, once, and carry on. Emergency switch is `TTS_PROVIDER=browser` in Vercel.
- **Microphone gives nothing twice**: tap the bar for the keyboard and type the question. The
  transcript path and the answer path are the same from there.
- **The app is down**: the backup video on the laptop, narrated live.

## Numbers to say if asked

- Reads: English one-page sheet, first warning 13 s, complete 39 s; Chinese, 49 s / 65 s.
- Questions: 4–9 s warm; a refusal is instant because no model is called.
- Accuracy on the two stage sheets, production, today: medicines 5/5 exact on both, the stopped
  drug never scheduled, warning signs 3/3, follow-ups 2/2, zero banned terms, zero repairs.
- The phone sends the page at 2400 px on the long edge (about 0.9 MB) because at 1600 px small
  Chinese print was misread; nothing else leaves the phone but the question and the voice clip.
