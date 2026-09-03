# Feature Specification: Discharge Sheet Agent

**Feature Branch**: `001-discharge-sheet-agent`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "A mobile web app for the adult child of a hospitalised parent. Photograph the discharge sheet (Hong Kong English or mainland Chinese), hear it explained in the parent's dialect (Cantonese or Mandarin): warning signs first, medicines exactly as printed, follow-up, the diet line, and then ask the agent questions about the sheet and hear the answers. A small profile remembers who you cook for and which dialect they hear, stored only on the phone. Later: unpack the diet line into a dish check, and a shareable card. Working name: Fit or Not. Built solo for the Vital Soft Healthcare track, AIx Origin Summit, Hong Kong, September 2026."

## User Scenarios & Testing *(mandatory)*

The primary user is **Ka-yan**, 42, who lives in Hong Kong and has just brought her 72-year-old mother home after a four-day hospital stay for poorly controlled blood pressure and newly found type 2 diabetes. She is holding one page of English medical abbreviations. Her mother reads only Chinese and speaks Cantonese. Ka-yan speaks Cantonese and Mandarin, and reads English slowly.

### User Story 1 - Hear the sheet in her language, then ask it questions (Priority: P1)

Ka-yan photographs the discharge sheet with her phone. Within a minute the app shows a short stack of cards and reads them aloud in Cantonese: first the warning signs that mean "go back to hospital now", then each medicine exactly as printed (name, strength, how much, how often), then the follow-up appointment, then the diet instruction if one is printed. Every card shows the line on the page it came from. Anything the app could not read is shown as "I couldn't read this part", never guessed.

Then she holds the microphone button and asks, in Mandarin, "the white pill, morning or night?" The app answers in Cantonese, reading from the medicine card and its source line, so her mother hears it too. If she asks something the sheet does not answer ("can she skip it if she feels fine?"), the app says the sheet does not say and points her to the pharmacist or the number on the sheet. She can type instead of speaking.

**Why this priority**: This is the product. Reading the sheet answers the judges' three filter questions (live demo, AI doing irreplaceable work, a specific user and pain). Asking it questions is what makes it an agent instead of a reader, and the answers come from the same cards, so it belongs in the same path.

**Independent Test**: Using the bundled synthetic Hong Kong English sheet, a tester with no English can, after one listen, restate the three warning signs, the number of medicines and the follow-up date; and for a fixed set of ten questions, every answerable question is answered from the matching card and every out-of-sheet question is refused. Testable with only a phone camera, microphone and speaker.

**Acceptance Scenarios**:

1. **Given** the consent notice has been accepted and Cantonese is selected, **When** Ka-yan photographs the synthetic Hong Kong sheet, **Then** the first card shown and spoken is the warning-signs card, followed by medicines, follow-up and diet, each with a visible source line.
2. **Given** the synthetic mainland Chinese 出院记录 with numbered 出院医嘱, **When** photographed, **Then** the same card order is produced, medicines match the printed dose and frequency exactly, and the diet line reads 低盐低脂饮食.
3. **Given** the badly photographed copy (angled, blurred, thumb in corner), **When** photographed, **Then** readable regions produce cards and each unreadable region produces an "I couldn't read this part" card pointing at the region, with no invented items.
4. **Given** a sheet with no printed warning signs, **When** photographed, **Then** the first card says no warning signs are printed and shows the hospital contact line from the sheet, or says the contact line is missing.
5. **Given** any card is displayed, **When** Ka-yan taps "play", **Then** the card is spoken in the selected dialect and every spoken output ends with the short inaccuracy caution.
6. **Given** a photo that is not a discharge sheet (a menu, a receipt), **When** photographed, **Then** the app says it does not look like a discharge sheet and offers to try again, producing no cards.
7. **Given** cards exist, **When** Ka-yan asks about a medicine's timing by voice or text, **Then** the answer restates the printed frequency, cites the source line, and is spoken in the parent's dialect.
8. **Given** a question about changing, skipping or adding a medicine, **When** asked, **Then** the app refuses to advise, points to the pharmacist or the hospital contact line, and shows no other answer.
9. **Given** a question the sheet does not cover, **When** asked, **Then** the app says the sheet does not say, suggests where to ask, and generates no answer from general knowledge.
10. **Given** the question contains words indicating personal crisis or self-harm, **When** submitted, **Then** the app shows the organisers' referral resources instead of an answer.
11. **Given** speech input is unavailable, **When** Ka-yan taps the microphone, **Then** a text box is offered instead.

---

### User Story 2 - Remember who she cooks for, and confirm the follow-up plan (Priority: P2)

On first use, Ka-yan answers two quick screens: who she cooks for (a label like 阿媽, not a name) and which dialect they hear. After a sheet is read, the app offers a plan built only from the sheet: the follow-up appointment and the medicine times as printed. Ka-yan reviews and confirms before anything is saved. Everything lives on her phone only, with a "delete everything" button.

**Why this priority**: The label makes the spoken sentences personal and the plan is the adherence-reminder feature the organisers named as their own example. Second because Story 1 works without it, with dialect chosen at the start of each session.

**Independent Test**: A first-time user completes the two screens in under 30 seconds; after reading a sheet, the confirmed plan lists the follow-up date and medicine times exactly as printed; after "delete everything", no profile, plan or reading remains and a fresh setup is offered.

**Acceptance Scenarios**:

1. **Given** a first launch, **When** Ka-yan completes setup, **Then** the profile holds only the relationship label and dialect, and holds no name, age, diagnosis, weight, readings or medicines.
2. **Given** a sheet has been read, **When** the plan is offered, **Then** every date and time on it matches a source line on the sheet, and nothing is saved until Ka-yan taps confirm.
3. **Given** the plan is confirmed, **When** the follow-up date passes, **Then** the app reminds her the sheet's instructions were written for the period up to that visit and to ask at follow-up, and changes nothing on its own.
4. **Given** a profile exists, **When** Ka-yan taps "delete everything" and confirms, **Then** profile, plan and any reading are removed from the phone.
5. **Given** any screen in setup, **When** it is displayed, **Then** a one-line statement is visible: stored only on this phone, nothing leaves it except the question you ask, no names, no diagnoses.

---

### Edge Cases

- The sheet has no diet line or says "normal diet": the diet card states that no food instruction is printed and suggests asking at follow-up.
- The diet line is recognised (低盐, 低脂, 糖尿病饮食, 清淡 or their English equivalents): the card shows it word for word plus one plain sentence of what it asks; any other instruction is shown word for word with no explanation.
- Two sheets or a multi-page summary: the app reads one page at a time and lets Ka-yan add a second page before the cards are built.
- Handwritten sections: read if legible, otherwise flagged unreadable; never guessed.
- A medicine has no frequency printed: the card says the frequency is not printed and to check the medicine label or ask the pharmacist.
- The follow-up date is missing or ambiguous: the plan omits it and says so; nothing is inferred.
- The reading service is unavailable: the app offers the bundled sample sheet so the flow can still be shown, and says clearly that it is a sample.
- Camera permission denied: the app offers to pick a photo from the phone's library, then typing.
- Speech output unavailable: cards and answers remain readable on screen in the chosen written form.
- Ka-yan photographs a real sheet: the image is discarded after reading and never stored; only the extracted text stays on the phone.
- A judge photographs an unrelated document or a food photo: the app declines and produces no cards.
- A generated sentence contains a banned term: it is regenerated once, then replaced by a fixed template sentence.
- A question mixes languages or dialects: the app answers in the parent's dialect regardless of the language asked in.
- The user asks about something on a card that was flagged unreadable: the app says that part could not be read and suggests re-photographing it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST read a photographed discharge sheet in either Hong Kong English format or mainland Chinese 出院记录 format and produce a structured reading containing warning signs, medicines, follow-up, diet line, activity line and unreadable regions.
- **FR-002**: The app MUST present the reading as cards in this fixed order: warning signs, medicines, follow-up, diet, activity, unreadable parts.
- **FR-003**: Each medicine card MUST reproduce the printed name, strength, amount and frequency exactly, and MUST NOT add, omit, round or reinterpret any of them.
- **FR-004**: Every card, every answer and every spoken sentence MUST carry a reference to its source line or region on the page, and the user MUST be able to view that source.
- **FR-005**: Regions that cannot be read MUST produce an explicit "could not read" card; the app MUST NOT fill gaps with inferred content.
- **FR-006**: The app MUST recognise when a photo is not a discharge sheet and MUST decline to produce cards for it.
- **FR-007**: The app MUST speak any card or answer aloud in Cantonese or Mandarin as selected, and MUST show the same content as on-screen text in the matching written form (traditional characters for Cantonese, simplified for Mandarin, switchable).
- **FR-008**: Every spoken output MUST end with a short inaccuracy caution, and every screen MUST display the disclaimer wording from the hackathon rules.
- **FR-009**: The app MUST label all generated text as AI-generated and MUST let the user edit or discard generated text before it is spoken.
- **FR-010**: Every generated string MUST pass a banned-term filter covering diagnose, treat, cure, prescribe, can eat, cannot eat and their Chinese forms, plus any numeric target about the person; on a hit the app MUST regenerate once and then use a fixed template.
- **FR-011**: The app MUST NOT diagnose, MUST NOT set personal targets, and MUST NOT advise changing, skipping or adding any medicine; such questions MUST be answered with a refusal that points to the pharmacist or the hospital contact line on the sheet.
- **FR-012**: The app MUST answer questions about the sheet by voice or text, taking the question in Cantonese, Mandarin or English and answering in the parent's dialect, and MUST ground every answer in a card and its source line.
- **FR-013**: When a question cannot be answered from the sheet, the app MUST say so and MUST NOT generate an answer from general knowledge.
- **FR-014**: When a question contains crisis or self-harm language, the app MUST show the organisers' referral resources instead of an answer.
- **FR-015**: The app MUST show a simulated-input notice with one-tap consent before the first health-related input in any session.
- **FR-016**: The app MUST provide a profile holding only a relationship label and a dialect. It MUST NOT collect name, age, diagnosis, weight, readings or medicine lists.
- **FR-017**: The profile, the plan and the most recent reading MUST be stored only on the user's device, with a "delete everything" action that removes all of them.
- **FR-018**: The photographed image MUST be discarded immediately after the reading is produced and MUST NOT be stored, logged or transmitted for any other purpose.
- **FR-019**: Any request sent outside the device for reading, answering or phrasing MUST contain only the material needed for that request and MUST NOT include the relationship label, plan dates, or any identifier.
- **FR-020**: The app MUST offer a follow-up plan whose every date and time comes from a source line on the sheet, MUST require explicit confirmation before saving it, MUST NOT alter doses, and MUST NOT contact, message or book anything on the user's behalf.
- **FR-021**: When the follow-up date has passed, the app MUST say the sheet's instructions were written for the period up to that visit and prompt the user to ask at follow-up; it MUST NOT extend or change anything on its own.
- **FR-022**: The app MUST state on screen what the agent can and cannot do: reads the sheet, answers questions from the sheet, builds a plan you confirm; never diagnoses, never changes medicines, never contacts anyone.
- **FR-023**: The app MUST ship with three synthetic sheets (Hong Kong English, mainland Chinese, badly photographed copy) usable as a sample when the camera or the reading service is unavailable, clearly marked as samples.
- **FR-024**: Each failure path MUST have a working fallback: camera to photo library to typing; speech input to typing; speech output to on-screen text; reading service to bundled sample.
- **FR-025**: The diet card MUST show the printed diet line word for word; for the recognised set (低盐, 低脂, 糖尿病饮食, 清淡 and their English equivalents) it MAY add one plain sentence of what the instruction asks; for any other instruction or no instruction it MUST add nothing.
- **FR-026**: The app MUST run on a phone browser without installation and MUST be reachable from a link, so judges can open it on their own devices.
- **FR-027**: The product name, all interface copy and all pitch material MUST obey the same banned-term list as generated text.

### Key Entities *(include if feature involves data)*

- **Sheet Reading**: the structured result of one photographed page: sheet type (Hong Kong English, mainland Chinese, unknown), warning signs, medicines, follow-up items, diet line and its recognised type, activity line, unreadable regions. Lives on the device until replaced or deleted.
- **Card**: one displayable, speakable unit of the reading (one warning sign, one medicine, one follow-up item, the diet line) with its text in both written forms and its Source Reference.
- **Source Reference**: the line or region of the page a card or answer came from, shown on demand; every card and every answer has exactly one.
- **Question**: one user query with its input language, the card it was answered from, the answer text in both written forms, and whether it was refused.
- **Profile**: relationship label and dialect. Device-only. No identifiers.
- **Follow-up Plan**: the confirmed list of dated items derived from the sheet (follow-up appointment, medicine times as printed). Each item keeps its Source Reference.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From tapping the shutter to hearing the first warning-sign card takes under 30 seconds on a phone over the venue network.
- **SC-002**: On the three synthetic sheets, 100% of printed medicines, follow-up dates and warning signs appear on cards or are flagged unreadable; zero items are invented and zero are silently omitted.
- **SC-003**: Across 100 consecutive generated outputs (cards and answers) on the synthetic sheets, zero contain a banned term after filtering.
- **SC-004**: 100% of cards, answers and spoken sentences expose a source reference the user can view.
- **SC-005**: Three Cantonese-speaking testers with no English can each restate the warning signs and the follow-up date after one listen of the Hong Kong English sheet.
- **SC-006**: For a fixed set of ten questions, all answerable questions cite the correct card and all out-of-sheet questions receive the refusal sentence; a spoken answer starts within 10 seconds of the question ending.
- **SC-007**: The full live path (photo, spoken cards, one question answered aloud, confirmed plan) completes on a phone without typing; each failure path recovers in two taps or fewer.
- **SC-008**: A first-time user completes profile setup in under 30 seconds.
- **SC-009**: Inspection of every outbound request confirms none carries the relationship label, plan dates or any identifier, and no image is retained after reading.
- **SC-010**: A judge shown an unrelated document sees the decline message within 10 seconds and no cards.

## Assumptions

- The demo runs in Hong Kong; Ka-yan and her mother are the demo persona; the demo case is a 72-year-old woman discharged after four days for poorly controlled blood pressure with newly found type 2 diabetes, three medicines, a 低盐低脂 diet line, follow-up in two weeks, three warning signs.
- Only two sheet formats are in scope for the sprint: Hong Kong English discharge summary and mainland Chinese 出院记录. Other documents (lab reports, consent forms, medicine boxes) are roadmap items.
- Only Cantonese and Mandarin output are in scope; other dialects are roadmap items. Questions may be asked in Cantonese, Mandarin or English.
- The parent is not a direct user in this version; a parent-facing voice mode is a roadmap item.
- No accounts, no sign-in and no server-side storage exist in this version; family sync is a roadmap item.
- Judges open the app in a phone browser from a link; the phone has speech output for Cantonese and Mandarin available. If a phone lacks a Cantonese voice, on-screen text is the fallback.
- Demo data is entirely synthetic and authored by the team; real sheets are never used.
- Reminder delivery in this version is an in-app plan the user confirms, with an option to add items to the phone's calendar; push notifications are a roadmap item.
- The rulebook in `rules.md` and the constitution in `.specify/memory/constitution.md` govern every requirement here; where they conflict, the rulebook wins.
- The builder is one person working with AI assistance; the constitution's "one live path first" rule orders the work: Story 1 to demo-ready, then Story 2.

## Later (roadmap, not in this feature)

Kept here so they are not re-litigated. None of these start during the sprint.

- **Dish check**: unpack the diet line into "what it asks / what it never asked you to remove", let the user describe tonight's dish by voice, mark each ingredient as fitting or not fitting the instruction, offer one cheap, chewable, salt-neutral swap from a local market list, and a sentence to say at the table. Needs a curated food table, chewing level and foods-to-avoid in the profile, and a specialised-diet lock.
- **Share card**: one image of the cards in the parent's dialect, no profile fields, for the relative who actually cooks.
- **Parent-facing voice mode**, **medicine-box reader checked against the sheet's medicine list**, **lab and 体检 report reading**, **family sync with accounts**.
