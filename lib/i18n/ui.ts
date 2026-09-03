/**
 * Every fixed string in the interface, in three locales.
 *
 * `hant` is traditional characters in colloquial written Cantonese (the daughter-to-mother
 * voice from design.md section 6), `hans` is simplified characters in Mandarin, `en` is
 * English. Nothing here is model-generated: this file is the fixed-template half of the
 * product and it is tested against the banned-term filter in tests/unit/ui-copy.test.ts.
 *
 * The ONE exemption is `disclaimer`, which is the rulebook's own required wording
 * (rules.md section 16) and therefore contains 診斷/治療 by mandate.
 */

export type UiLocale = "hant" | "hans" | "en";

const hant = {
  // --- S1 Consent gate -----------------------------------------------------
  "consent.title": "呢個係示範用嘅資料",
  "consent.body1": "入面用嘅出院紙都係我哋自己寫嘅示範紙，唔係真人嘅。",
  "consent.body2": "你影嘅嘢淨係留喺呢部電話。冇名，冇病名，冇戶口。",
  "consent.button": "明白，開始",

  // --- S2 Session language -------------------------------------------------
  "language.question": "阿媽聽咩話？",
  "language.yue": "廣東話",
  "language.cmn": "普通話",
  "language.en": "English",
  "script.label": "字體",
  "script.hant": "繁",
  "script.hans": "简",

  // --- S3 Capture ----------------------------------------------------------
  "capture.title": "影低張出院紙",
  "capture.camera": "影相",
  "capture.library": "相簿揀相",
  "capture.type": "打字輸入",
  "capture.sample": "用示範紙",
  "capture.addPage": "加第二頁",
  "capture.start": "開始讀",
  "capture.retake": "再影一次",

  // --- S3 Reading progress -------------------------------------------------
  "progress.step1": "讀緊",
  "progress.step2": "執緊重點",
  "progress.step3": "準備讀出",
  "progress.note": "首先會讀警號",

  // --- S3 Not a sheet ------------------------------------------------------
  "notASheet.title": "睇落唔似出院紙",
  "notASheet.body": "我淨係讀得出出院紙。換張相或者用示範紙睇下點運作。",

  // --- S4 Cards ------------------------------------------------------------
  "cards.header": "出院紙",
  "cards.forLabel": "讀畀{label}聽",
  "cards.sampleBanner": "示範紙，唔係真嘅",
  "cards.playAll": "全部讀出",
  "cards.ask": "問問題",
  "cards.play": "讀出嚟",
  "cards.playing": "讀緊…",
  "cards.stop": "停",
  "card.warning": "警號",
  "card.medicine": "藥",
  "card.followUp": "覆診",
  "card.diet": "食嘢",
  "card.activity": "郁動同休息",
  "card.unreadable": "讀唔到",
  "card.noWarnings": "張紙冇印警號",
  "card.referral": "可以搵嘅資源",
  "card.noWarningsBody": "張紙冇印幾時要即刻返醫院。下面係張紙上面嘅醫院電話。",
  "card.missingFrequency": "用法冇印，睇藥袋或者問藥劑師",
  "card.unreadableBody": "呢部分讀唔到",
  "card.sourceLink": "睇張紙點寫",

  // --- S5 Source sheet -----------------------------------------------------
  "source.title": "張紙上面點寫",
  "source.section": "段落",
  "source.line": "行",
  "source.lineUnknown": "行數唔肯定",
  "source.close": "閂返",

  // --- S6 Ask --------------------------------------------------------------
  "ask.title": "問問題",
  "ask.placeholder": "打字問，或者撳住個咪講",
  "ask.hold": "撳住講",
  "ask.holding": "聽緊…",
  "ask.processing": "諗緊…",
  "ask.send": "問",
  "ask.edit": "改一改先",
  "ask.inputLanguage": "你想用咩話問？",
  "ask.answered": "答案",
  "ask.answeredFrom": "出自",
  "ask.refused": "呢樣要問藥劑師",
  "ask.refusedBody": "藥物點樣食、要唔要調整，都要問返醫生或者藥劑師。張紙上面嘅電話喺下面。",
  "ask.notOnSheet": "張紙冇講呢樣",
  "ask.notOnSheetBody": "我淨係讀到張紙上面有嘅嘢。呢樣可以覆診嗰陣問吓。",
  "ask.referral": "呢度有人可以幫手",
  "ask.referralBody": "如果而家好危險，即刻打下面嘅電話。",
  "ask.referralCall": "打電話",

  // --- S7 Setup ------------------------------------------------------------
  "setup.labelQuestion": "你煮飯畀邊個？",
  "setup.labelHint": "揀個稱呼就得，唔使寫名。",
  "setup.chip.mother": "阿媽",
  "setup.chip.father": "阿爸",
  "setup.chip.dad": "老豆",
  "setup.chip.motherInLaw": "家婆",
  "setup.chip.other": "其他",
  "setup.otherPlaceholder": "自己寫個稱呼",
  "setup.dialectQuestion": "佢聽咩話？",
  "setup.privacy": "只會存喺呢部電話，除咗你問嘅問題，乜都唔會傳出去。冇名，冇病名。",
  "setup.next": "繼續",
  "setup.done": "搞掂",

  // --- S8 Plan -------------------------------------------------------------
  "plan.title": "覆診同食藥時間",
  "plan.appointment": "覆診",
  "plan.medicineTime": "食藥時間",
  "plan.draftNote": "撳確認之前，乜都唔會存。",
  "plan.confirm": "確認",
  "plan.addToCalendar": "加入日曆",
  "plan.expired": "張紙嘅指示係寫到覆診嗰日為止，覆診時問吓仲使唔使",
  "plan.empty": "張紙冇印到日期同時間，所以整唔到計劃。",

  // --- S9 Settings ---------------------------------------------------------
  "settings.title": "設定",
  "settings.dataStatement": "你啲資料去咗邊",
  "settings.delete": "刪除所有資料",
  "settings.deleteConfirmTitle": "刪除所有資料？",
  "settings.deleteConfirmBody": "呢部電話上面嘅稱呼、讀過嘅紙同計劃全部會冇咗，攞唔返。",
  "settings.deleteConfirm": "刪除",
  "settings.cancel": "唔刪住",
  "settings.deleted": "全部刪咗喇。",

  // --- S10 Fallbacks -------------------------------------------------------
  "fallback.noVoice": "睇字",
  "fallback.noVoiceNote": "而家出唔到聲，內容喺下面睇得到。",
  "fallback.modelUnavailable": "而家讀唔到，用示範紙睇下點運作",
  "fallback.cameraDenied": "用唔到相機。可以喺相簿揀相，或者打字輸入。",
  "fallback.offline": "而家connect唔到。示範紙照用得。",

  // --- Persistent, every screen -------------------------------------------
  // EXEMPT from the banned-term filter: this is rules.md section 16 verbatim wording.
  "disclaimer":
    "本工具只係幫你理解出院紙，唔係醫療建議，唔可以代替醫護人員嘅診斷同治療。有疑問請問返醫生或者藥劑師。AI 寫嘅內容可能有錯。",
  "aiChip": "AI 寫嘅，可能有錯",
  "cautionSuffix": "AI 寫嘅，可能有錯。",
  "agentLimits.title": "佢做到啲咩",
  "agentLimits.can": "佢會做：讀出張紙、答張紙上面嘅嘢、幫你整個計劃你確認。",
  "agentLimits.cannot": "佢唔會做：唔會斷症、唔會改藥、唔會幫你聯絡任何人。",
} as const;

export type UiKey = keyof typeof hant;

const hans: Record<UiKey, string> = {
  "consent.title": "这里用的是示范资料",
  "consent.body1": "里面的出院纸都是我们自己写的示范纸，不是真人的。",
  "consent.body2": "你拍的东西只留在这部手机里。没有名字，没有病名，没有账号。",
  "consent.button": "明白，开始",

  "language.question": "妈妈听哪种话？",
  "language.yue": "广东话",
  "language.cmn": "普通话",
  "language.en": "English",
  "script.label": "字体",
  "script.hant": "繁",
  "script.hans": "简",

  "capture.title": "拍下这张出院纸",
  "capture.camera": "拍照",
  "capture.library": "从相册选",
  "capture.type": "打字输入",
  "capture.sample": "用示范纸",
  "capture.addPage": "加第二页",
  "capture.start": "开始读",
  "capture.retake": "重拍一次",

  "progress.step1": "读取中",
  "progress.step2": "整理重点",
  "progress.step3": "准备念出来",
  "progress.note": "先念警号",

  "notASheet.title": "看起来不像出院纸",
  "notASheet.body": "我只读得懂出院纸。换一张照片，或者用示范纸看看怎么用。",

  "cards.header": "出院纸",
  "cards.forLabel": "念给{label}听",
  "cards.sampleBanner": "示范纸，不是真的",
  "cards.playAll": "全部念出来",
  "cards.ask": "问问题",
  "cards.play": "念出来",
  "cards.playing": "念紧…",
  "cards.stop": "停",
  "card.warning": "警号",
  "card.medicine": "药",
  "card.followUp": "复诊",
  "card.diet": "吃的方面",
  "card.activity": "活动和休息",
  "card.unreadable": "读不到",
  "card.noWarnings": "这张纸没印警号",
  "card.referral": "可以找的资源",
  "card.noWarningsBody": "这张纸没印什么时候要马上回医院。下面是纸上写的医院电话。",
  "card.missingFrequency": "用法没印，看药袋或者问药剂师",
  "card.unreadableBody": "这部分读不到",
  "card.sourceLink": "看纸上怎么写",

  "source.title": "纸上怎么写",
  "source.section": "段落",
  "source.line": "行",
  "source.lineUnknown": "行数不确定",
  "source.close": "关掉",

  "ask.title": "问问题",
  "ask.placeholder": "打字问，或者按住话筒讲",
  "ask.hold": "按住讲",
  "ask.holding": "在听…",
  "ask.processing": "在想…",
  "ask.send": "问",
  "ask.edit": "先改一改",
  "ask.inputLanguage": "你想用哪种话问？",
  "ask.answered": "答案",
  "ask.answeredFrom": "出自",
  "ask.refused": "这个要问药剂师",
  "ask.refusedBody": "药物怎么吃、要不要调整，都要问回医生或者药剂师。纸上写的电话在下面。",
  "ask.notOnSheet": "这张纸没讲这个",
  "ask.notOnSheetBody": "我只读得到纸上有的内容。这个可以复诊的时候问一下。",
  "ask.referral": "这里有人可以帮忙",
  "ask.referralBody": "如果现在很危险，马上打下面的电话。",
  "ask.referralCall": "打电话",

  "setup.labelQuestion": "你做饭给谁吃？",
  "setup.labelHint": "选个称呼就好，不用写名字。",
  "setup.chip.mother": "妈妈",
  "setup.chip.father": "爸爸",
  "setup.chip.dad": "老爸",
  "setup.chip.motherInLaw": "婆婆",
  "setup.chip.other": "其他",
  "setup.otherPlaceholder": "自己写个称呼",
  "setup.dialectQuestion": "他听哪种话？",
  "setup.privacy": "只存在这部手机里，除了你问的问题，什么都不会传出去。没有名字，没有病名。",
  "setup.next": "继续",
  "setup.done": "好了",

  "plan.title": "复诊和吃药时间",
  "plan.appointment": "复诊",
  "plan.medicineTime": "吃药时间",
  "plan.draftNote": "按确认之前，什么都不会存。",
  "plan.confirm": "确认",
  "plan.addToCalendar": "加入日历",
  "plan.expired": "这张纸的说明写到复诊那天为止，复诊时问问还要不要继续",
  "plan.empty": "这张纸没印日期和时间，所以做不了计划。",

  "settings.title": "设置",
  "settings.dataStatement": "你的资料去了哪里",
  "settings.delete": "删除所有资料",
  "settings.deleteConfirmTitle": "删除所有资料？",
  "settings.deleteConfirmBody": "这部手机上的称呼、读过的纸和计划都会没了，拿不回来。",
  "settings.deleteConfirm": "删除",
  "settings.cancel": "先不删",
  "settings.deleted": "全部删掉了。",

  "fallback.noVoice": "看文字",
  "fallback.noVoiceNote": "现在出不了声音，内容在下面看得到。",
  "fallback.modelUnavailable": "现在读不了，用示范纸看看怎么用",
  "fallback.cameraDenied": "用不了相机。可以从相册选，或者打字输入。",
  "fallback.offline": "现在连不上。示范纸还是能用。",

  // EXEMPT: rules.md section 16 verbatim wording.
  "disclaimer":
    "本工具仅供健康信息参考与支持，不构成医疗建议，不能取代专业医护人员的诊断或治疗。如有健康疑虑，请咨询注册医生或相关专业人士。AI 生成内容可能不准确。",
  "aiChip": "AI 写的，可能有错",
  "cautionSuffix": "AI 写的，可能有错。",
  "agentLimits.title": "它做得到什么",
  "agentLimits.can": "它会做：念出这张纸、回答纸上有的内容、帮你整理一份你确认的计划。",
  "agentLimits.cannot": "它不会做：不会判断病情、不会改药、不会替你联系任何人。",
};

const en: Record<UiKey, string> = {
  "consent.title": "This is a demo with made-up sheets",
  "consent.body1": "Every discharge sheet in here was written by us as a sample. None of it is real.",
  "consent.body2": "What you photograph stays on this phone. No names, no illness names, no account.",
  "consent.button": "Got it, start",

  "language.question": "Which language does she listen in?",
  "language.yue": "Cantonese",
  "language.cmn": "Mandarin",
  "language.en": "English",
  "script.label": "Characters",
  "script.hant": "Traditional",
  "script.hans": "Simplified",

  "capture.title": "Photograph the discharge sheet",
  "capture.camera": "Take a photo",
  "capture.library": "Pick from photos",
  "capture.type": "Type it instead",
  "capture.sample": "Use a sample sheet",
  "capture.addPage": "Add a second page",
  "capture.start": "Start reading",
  "capture.retake": "Take it again",

  "progress.step1": "Reading",
  "progress.step2": "Picking out the key lines",
  "progress.step3": "Getting ready to speak",
  "progress.note": "The warning signs come first",

  "notASheet.title": "This doesn't look like a discharge sheet",
  "notASheet.body":
    "I can only read discharge sheets. Try another photo, or open a sample sheet to see how this works.",

  "cards.header": "Discharge sheet",
  "cards.forLabel": "Read to {label}",
  "cards.sampleBanner": "Sample sheet, not a real one",
  "cards.playAll": "Play all",
  "cards.ask": "Ask a question",
  "cards.play": "Play",
  "cards.playing": "Speaking…",
  "cards.stop": "Stop",
  "card.warning": "Warning signs",
  "card.medicine": "Medicine",
  "card.followUp": "Follow-up",
  "card.diet": "Food line",
  "card.activity": "Activity and rest",
  "card.unreadable": "Couldn't read",
  "card.noWarnings": "No warning signs printed",
  "card.referral": "People who can help",
  "card.noWarningsBody":
    "This sheet doesn't print when to go back to hospital. The hospital number printed on the sheet is below.",
  "card.missingFrequency": "How often isn't printed. Check the bag or ask the pharmacist.",
  "card.unreadableBody": "I couldn't read this part",
  "card.sourceLink": "See it on the page",

  "source.title": "What the page says",
  "source.section": "Section",
  "source.line": "Line",
  "source.lineUnknown": "Line number unclear",
  "source.close": "Close",

  "ask.title": "Ask a question",
  "ask.placeholder": "Type a question, or hold the mic and speak",
  "ask.hold": "Hold to speak",
  "ask.holding": "Listening…",
  "ask.processing": "Thinking…",
  "ask.send": "Ask",
  "ask.edit": "Edit first",
  "ask.inputLanguage": "Which language will you ask in?",
  "ask.answered": "Answer",
  "ask.answeredFrom": "From",
  "ask.refused": "Ask the pharmacist about this",
  "ask.refusedBody":
    "How a medicine is taken, and whether anything about it changes, is for the doctor or the pharmacist. The number printed on the sheet is below.",
  "ask.notOnSheet": "The sheet doesn't say",
  "ask.notOnSheetBody":
    "I only read what is on the page. This one is worth raising at the follow-up visit.",
  "ask.referral": "There are people who can help",
  "ask.referralBody": "If someone is in danger right now, call one of the numbers below.",
  "ask.referralCall": "Call",

  "setup.labelQuestion": "Who do you cook for?",
  "setup.labelHint": "Pick a word for them. No name needed.",
  "setup.chip.mother": "Mum",
  "setup.chip.father": "Dad",
  "setup.chip.dad": "My old man",
  "setup.chip.motherInLaw": "Mother-in-law",
  "setup.chip.other": "Someone else",
  "setup.otherPlaceholder": "Write your own word",
  "setup.dialectQuestion": "Which language do they listen in?",
  "setup.privacy":
    "Kept on this phone only. Nothing leaves it except the question you ask. No name, no illness name.",
  "setup.next": "Continue",
  "setup.done": "Done",

  "plan.title": "Follow-up and medicine times",
  "plan.appointment": "Follow-up visit",
  "plan.medicineTime": "Medicine time",
  "plan.draftNote": "Nothing is saved until you confirm.",
  "plan.confirm": "Confirm",
  "plan.addToCalendar": "Add to calendar",
  "plan.expired":
    "The sheet's instructions were written for the period up to that visit. Ask at the follow-up whether they still hold.",
  "plan.empty": "This sheet doesn't print dates or times, so there is no plan to build.",

  "settings.title": "Settings",
  "settings.dataStatement": "Where your information goes",
  "settings.delete": "Delete everything",
  "settings.deleteConfirmTitle": "Delete everything?",
  "settings.deleteConfirmBody":
    "The word you chose, the sheet you read and the plan all go from this phone. There is no undo.",
  "settings.deleteConfirm": "Delete",
  "settings.cancel": "Keep it",
  "settings.deleted": "All gone.",

  "fallback.noVoice": "Read it instead",
  "fallback.noVoiceNote": "No voice right now. The words are below.",
  "fallback.modelUnavailable": "Can't read a sheet right now. Open a sample to see how it works.",
  "fallback.cameraDenied": "The camera isn't available. Pick a photo, or type it instead.",
  "fallback.offline": "No connection right now. The sample sheets still work.",

  // EXEMPT: rules.md section 16 verbatim wording.
  "disclaimer":
    "This tool provides health information reference and support only. It is not medical advice and cannot replace diagnosis or treatment by professional medical staff. If you have health concerns, consult a registered doctor or relevant professional. AI-generated content may be inaccurate.",
  "aiChip": "Written by AI, may be wrong",
  "cautionSuffix": "Written by AI, may be wrong.",
  "agentLimits.title": "What it does and doesn't do",
  "agentLimits.can":
    "It will: read the sheet out, answer questions about what is on the sheet, and draft a plan you confirm.",
  "agentLimits.cannot":
    "It will not: say what is wrong with anyone, change any medicine, or contact anyone for you.",
};

export const UI: Record<UiLocale, Record<UiKey, string>> = { hant, hans, en };

/** The single key whose wording is mandated by rules.md section 16 and is filter-exempt. */
export const DISCLAIMER_KEY = "disclaimer" satisfies UiKey;

export const UI_KEYS = Object.keys(hant) as UiKey[];

export const UI_LOCALES: UiLocale[] = ["hant", "hans", "en"];

/** Looks up one fixed string. There is no interpolation: every value here is a whole sentence. */
export function t(locale: UiLocale, key: UiKey): string {
  return UI[locale][key];
}
