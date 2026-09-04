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
  "fallback.cameraDenied": "用唔到相機。喺相簿揀張出院紙嘅相都得。",
  "fallback.offline": "而家connect唔到。示範紙照用得。",

  // ==========================================================================
  // v2 — the three-tab flow (docs/v2-build-brief.md).
  //
  // Cantonese is taken VERBATIM from design-canvas/workflow-v2.dc.html wherever the canvas has
  // the line; Mandarin and English are written to match its register — a daughter explaining a
  // page to her mother, not a hospital leaflet.
  //
  // PLACEHOLDERS. Some of these carry {n}, {name}, {printed}, {text} or {date}. The caller fills
  // them with a plain string replace, never a model turn. The unit test asserts that all three
  // locales of a key carry the same placeholders: a dropped {n} in one script is a counter that
  // silently stops counting.
  //
  // NO CLOCK TIMES, EVER. A discharge sheet prints a FREQUENCY (「每日兩次，隨餐」), never a time
  // of day, so a counter counts REMAINING TIMES TODAY and nothing else. Printing "8pm" would be
  // prescribing (brief section 2, rule 7). This is the one place the canvas is deliberately not
  // followed: its check-in reply says 「夜晚仲有一次」, which invents an evening dose the page
  // never printed — it is 「今日仲有 N 次」 here. If you add a counter string, count times.
  // ==========================================================================

  // --- V2 Tabs -------------------------------------------------------------
  "tab.record": "記錄",
  "tab.chat": "傾偈",
  "tab.track": "跟進",
  "tab.navLabel": "主要頁面",
  "tab.chatPending": "明仔有嘢想問你",

  // --- V2 明仔 -------------------------------------------------------------
  // He is drawn, never labelled: components/Mascot.tsx is aria-hidden and THIS is the real text.
  "mascot.name": "明仔",

  // --- V2 記錄 -------------------------------------------------------------
  "home.title": "記錄",
  "home.emptySubtitle": "出院張紙，拍咗或者揀相俾我睇。",
  "home.emptyMascot": "仲未有紙。拍完我就即刻講俾你聽。",
  "home.nowTalking": "傾緊呢張",
  "home.pages": "{n} 頁",
  "home.medicines": "{n} 隻藥",
  "home.chatNotStarted": "未講過",
  "home.chatPartway": "講到一半",
  "home.chatDone": "講完晒 · 有問題就問我",
  "home.dosesLeft": "今日嘅藥：仲有 {n} 次",
  "home.dosesDone": "今日嘅藥：食晒",
  "home.older": "以前嘅 ({n})",
  "home.readOnly": "只可以睇",

  // --- V2 Capture buttons --------------------------------------------------
  // The sub-labels are the English gloss the canvas prints under the Chinese label, for the adult
  // child holding the phone. In the English interface they say something else, not the same thing.
  "capture.photo": "拍張紙",
  "capture.photoSub": "Take a photo",
  "capture.upload": "上載相片",
  "capture.uploadSub": "From your photos",

  // --- V2 Camera -----------------------------------------------------------
  // Six pages is the ceiling and it is said in all three places it can bite. A medical document
  // is never silently truncated: if the app cannot take a page it has to say so.
  "camera.hintFirst": "成張紙入框",
  "camera.hintFirstSub": "Whole page inside the frame",
  "camera.hintNext": "仲有下一頁？",
  "camera.hintNextSub": "Shoot the next page, or press 完成",
  "camera.hintFull": "夠 6 頁喇，按「完成」",
  "camera.hintFullSub": "Six pages is the maximum",
  "camera.done": "完成",
  "camera.guiding": "講住指示",
  "camera.edgesLocked": "對正咗 · 揸穩部機",
  "camera.close": "熄相機",
  "camera.shutter": "影一張",

  // --- V2 Photo picker -----------------------------------------------------
  "pick.title": "揀你部電話嘅相",
  "pick.subtitle": "出院紙嘅相或者 PDF 都可以 · 最多 6 張",
  "pick.subtitleFull": "揀夠 6 張喇",
  "pick.use": "用揀好嘅 {n} 張",
  "pick.useNone": "揀最少一張",

  // --- V2 Review -----------------------------------------------------------
  "review.title": "睇下夠唔夠清楚",
  "review.subtitle": "矇嘅可以再拍",
  "review.retake": "再拍",
  "review.addPage": "加一頁",
  "review.onDevice": "張紙留在你電話。你唔send，冇人睇到。",
  "review.start": "講俾我聽",

  // --- V2 Reading ----------------------------------------------------------
  "reading.title": "讀住你張紙…",
  // Measured, not hoped for: a clean one-page read ran 27–46 s against the live model
  // (tests/eval/results.md) and the hard fixtures 45–105 s. The screen used to promise ten
  // seconds, which is a false promise on the one screen where the user has nothing to do but
  // wait — and on a stack of six pages it was out by a factor of ten.
  "reading.meta": "{n} 頁 · 大概半分鐘",
  "reading.metaLong": "{n} 頁 · 可能要一兩分鐘",

  // --- V2 Chat shell -------------------------------------------------------
  "chat.back": "返去記錄",
  "chat.sheetLine": "{date}出院紙",
  "chat.muteSpeaker": "熄咗把聲",
  "chat.unmuteSpeaker": "開返把聲",
  "chat.language": "揀用邊種話",
  "chat.today": "今日",
  "chat.reading": "讀住",
  "chat.readingThis": "讀住呢段",

  // --- V2 The briefing -----------------------------------------------------
  "brief.intro": "我睇完你張紙。最緊要嘅先講。",
  "brief.warnTitle": "有呢啲情況，即刻返醫院",
  "brief.understandQuestion": "明唔明？",
  "brief.repeat": "再講一次",
  "brief.understand": "明白",
  "brief.left": "仲有 {n} 段",
  "brief.end": "講完晒。有咩想問，按住下面個框講。",
  "brief.trackLink": "睇「跟進」嘅藥同覆診",

  // --- V2 The bar: hold to talk, tap to type -------------------------------
  "bar.hold": "按住講嘢",
  "bar.holdSub": "· 點一下打字",
  "bar.listening": "聽住你講…",
  "bar.listeningSub": "· 放手就送出",
  "bar.typePlaceholder": "打字問我…",
  "bar.send": "送",
  "bar.backToVoice": "改用講嘢",

  // --- V2 The check-in -----------------------------------------------------
  // {printed} is the frequency clause VERBATIM off the page. The template is fixed; a model turn
  // never assembles this question and never fills that slot.
  "checkin.question": "今日食咗{name}未？張紙寫{printed}。",
  "checkin.took": "食咗",
  "checkin.notYet": "未食",
  "checkin.tookReply": "好，我幫你記低咗。今日仲有 {n} 次。",
  "checkin.tookReplyAll": "好，我幫你記低咗。今日食晒喇。",
  // 未食 quotes the page back and stops. No nudge, no "remember to", no second ask.
  "checkin.notYetReply": "張紙寫：{printed}",

  // --- V2 跟進 -------------------------------------------------------------
  "track.title": "跟進",
  "track.following": "跟緊呢張紙",
  "track.nextVisit": "下次覆診",
  "track.daysAfter": "{n} 日之後",
  "track.todayMeds": "今日嘅藥",
  "track.warnings": "危險訊號 ({n})",
  "track.saySigns": "叫明仔講一次",
  "appt.directions": "睇下點去",

  // --- V2 Dose cards -------------------------------------------------------
  // `card.printed` is the one wrapper for verbatim page text: the dose frequency, the appointment
  // line when the date would not parse, and the 未食 reply all quote through it.
  "card.printed": "張紙寫：{text}",
  "dose.left": "今日仲有 {n} 次",
  "dose.done": "今日食晒",
  "dose.asNeeded": "唔痛就唔使食",
  // A stopped medicine still shows — the family needs to know the page names it — with no button
  // and no counter (brief section 2, rule 8).
  "dose.stopped": "張紙寫唔使再食",
  "dose.take": "食咗",

  // --- V2 Sheets (the UI kind) ---------------------------------------------
  "sheet.close": "閂返",

  // --- Persistent, every screen -------------------------------------------
  // EXEMPT from the banned-term filter: this is rules.md section 16 verbatim wording.
  //
  // A straight traditional-character rendering of the mandated text, NOT a colloquial paraphrase.
  // It used to read 「本工具只係幫你理解出院紙…」, which is warmer and easier for the reader this
  // app is built for — but it narrowed the scope to one document, dropped 註冊 from "registered
  // doctor" and replaced 相關專業人士 with 藥劑師. §16 says the wording must be shown, `hant` is
  // the default locale, and a judge string-matching the rulebook would not have found it here.
  // The app's own voice lives in every other string; this one is the rulebook's.
  "disclaimer":
    "本工具僅供健康信息參考與支持，不構成醫療建議，不能取代專業醫護人員的診斷或治療。如有健康疑慮，請諮詢註冊醫生或相關專業人士。AI 生成內容可能不準確。",
  "aiChip": "AI 寫嘅，可能有錯",
  "cautionSuffix": "AI 寫嘅，可能有錯。",
  "agentLimits.title": "佢做到啲咩",
  "agentLimits.can": "佢會做：讀出張紙、答張紙上面嘅嘢、數住今日仲有幾多次藥。",
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
  "fallback.cameraDenied": "用不了相机。从相册选一张出院纸的照片也可以。",
  "fallback.offline": "现在连不上。示范纸还是能用。",

  // --- V2 Tabs -------------------------------------------------------------
  "tab.record": "记录",
  "tab.chat": "聊天",
  "tab.track": "跟进",
  "tab.navLabel": "主要页面",
  "tab.chatPending": "明仔有话想问你",

  // --- V2 明仔 -------------------------------------------------------------
  "mascot.name": "明仔",

  // --- V2 记录 -------------------------------------------------------------
  "home.title": "记录",
  "home.emptySubtitle": "出院这张纸，拍一张或者选张照片给我看。",
  "home.emptyMascot": "还没有纸。拍好我就马上讲给你听。",
  "home.nowTalking": "在聊这张",
  "home.pages": "{n} 页",
  "home.medicines": "{n} 种药",
  "home.chatNotStarted": "还没讲过",
  "home.chatPartway": "讲到一半",
  "home.chatDone": "讲完了 · 有问题就问我",
  "home.dosesLeft": "今天的药：还有 {n} 次",
  "home.dosesDone": "今天的药：吃完了",
  "home.older": "以前的 ({n})",
  "home.readOnly": "只可以看",

  // --- V2 Capture buttons --------------------------------------------------
  "capture.photo": "拍这张纸",
  "capture.photoSub": "Take a photo",
  "capture.upload": "上传照片",
  "capture.uploadSub": "From your photos",

  // --- V2 Camera -----------------------------------------------------------
  "camera.hintFirst": "整张纸进框",
  "camera.hintFirstSub": "Whole page inside the frame",
  "camera.hintNext": "还有下一页吗？",
  "camera.hintNextSub": "Shoot the next page, or press 完成",
  "camera.hintFull": "够 6 页了，按「完成」",
  "camera.hintFullSub": "Six pages is the maximum",
  "camera.done": "完成",
  "camera.guiding": "边讲边教你",
  "camera.edgesLocked": "对准了 · 拿稳手机",
  "camera.close": "关掉相机",
  "camera.shutter": "拍一张",

  // --- V2 Photo picker -----------------------------------------------------
  "pick.title": "选你手机里的照片",
  "pick.subtitle": "出院纸的照片或者 PDF 都可以 · 最多 6 张",
  "pick.subtitleFull": "选够 6 张了",
  "pick.use": "用选好的 {n} 张",
  "pick.useNone": "至少选一张",

  // --- V2 Review -----------------------------------------------------------
  "review.title": "看看够不够清楚",
  "review.subtitle": "模糊的可以重拍",
  "review.retake": "重拍",
  "review.addPage": "加一页",
  "review.onDevice": "这张纸留在你手机里。你不发出去，没人看得到。",
  "review.start": "讲给我听",

  // --- V2 Reading ----------------------------------------------------------
  "reading.title": "读着你的纸…",
  "reading.meta": "{n} 页 · 大概半分钟",
  "reading.metaLong": "{n} 页 · 可能要一两分钟",

  // --- V2 Chat shell -------------------------------------------------------
  "chat.back": "回到记录",
  "chat.sheetLine": "{date}出院纸",
  "chat.muteSpeaker": "关掉声音",
  "chat.unmuteSpeaker": "打开声音",
  "chat.language": "选用哪种话",
  "chat.today": "今天",
  "chat.reading": "读着",
  "chat.readingThis": "读着这段",

  // --- V2 The briefing -----------------------------------------------------
  "brief.intro": "我看完你的纸了。最要紧的先讲。",
  "brief.warnTitle": "有这些情况，马上回医院",
  "brief.understandQuestion": "明白吗？",
  "brief.repeat": "再讲一次",
  "brief.understand": "明白",
  "brief.left": "还有 {n} 段",
  "brief.end": "讲完了。有什么想问，按住下面那个框讲。",
  "brief.trackLink": "看「跟进」里的药和复诊",

  // --- V2 The bar ----------------------------------------------------------
  "bar.hold": "按住说话",
  "bar.holdSub": "· 点一下打字",
  "bar.listening": "听着你说…",
  "bar.listeningSub": "· 放开就发出",
  "bar.typePlaceholder": "打字问我…",
  "bar.send": "发",
  "bar.backToVoice": "改用说话",

  // --- V2 The check-in -----------------------------------------------------
  "checkin.question": "今天吃了{name}没有？纸上写{printed}。",
  "checkin.took": "吃了",
  "checkin.notYet": "还没吃",
  "checkin.tookReply": "好，我帮你记下了。今天还有 {n} 次。",
  "checkin.tookReplyAll": "好，我帮你记下了。今天吃完了。",
  "checkin.notYetReply": "纸上写：{printed}",

  // --- V2 跟进 -------------------------------------------------------------
  "track.title": "跟进",
  "track.following": "跟着这张纸",
  "track.nextVisit": "下次复诊",
  "track.daysAfter": "{n} 天之后",
  "track.todayMeds": "今天的药",
  "track.warnings": "危险讯号 ({n})",
  "track.saySigns": "叫明仔讲一次",
  "appt.directions": "看看怎么去",

  // --- V2 Dose cards -------------------------------------------------------
  "card.printed": "纸上写：{text}",
  "dose.left": "今天还有 {n} 次",
  "dose.done": "今天吃完了",
  "dose.asNeeded": "不痛就不用吃",
  "dose.stopped": "纸上写不用再吃",
  "dose.take": "吃了",

  // --- V2 Sheets (the UI kind) ---------------------------------------------
  "sheet.close": "关掉",

  // EXEMPT: rules.md section 16 verbatim wording.
  "disclaimer":
    "本工具仅供健康信息参考与支持，不构成医疗建议，不能取代专业医护人员的诊断或治疗。如有健康疑虑，请咨询注册医生或相关专业人士。AI 生成内容可能不准确。",
  "aiChip": "AI 写的，可能有错",
  "cautionSuffix": "AI 写的，可能有错。",
  "agentLimits.title": "它做得到什么",
  "agentLimits.can": "它会做：念出这张纸、回答纸上有的内容、数着今天还有几次药。",
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
  "fallback.cameraDenied": "The camera isn't available. Choose a photo of the discharge sheet instead.",
  "fallback.offline": "No connection right now. The sample sheets still work.",

  // --- V2 Tabs -------------------------------------------------------------
  "tab.record": "Sheets",
  "tab.chat": "Chat",
  "tab.track": "Follow-up",
  "tab.navLabel": "Main sections",
  "tab.chatPending": "Ming has a question waiting",

  // --- V2 明仔 -------------------------------------------------------------
  // Romanised for the English interface. He is still 明仔 to the parent, who hears him, not reads.
  "mascot.name": "Ming",

  // --- V2 Sheets tab -------------------------------------------------------
  "home.title": "Sheets",
  "home.emptySubtitle": "Photograph the discharge sheet, or pick a photo of it.",
  "home.emptyMascot": "No sheet yet. Photograph one and I'll read it to you straight away.",
  "home.nowTalking": "The sheet we're on",
  "home.pages": "{n} pages",
  "home.medicines": "{n} medicines",
  "home.chatNotStarted": "Not read yet",
  "home.chatPartway": "Halfway through",
  "home.chatDone": "All read · ask me anything",
  "home.dosesLeft": "Today's medicine: {n} left",
  "home.dosesDone": "Today's medicine: all taken",
  "home.older": "Earlier sheets ({n})",
  "home.readOnly": "Read-only",

  // --- V2 Capture buttons --------------------------------------------------
  // In English the main label already says it, so the second line says something else.
  "capture.photo": "Take a photo",
  "capture.photoSub": "Use the camera",
  "capture.upload": "Pick a photo",
  "capture.uploadSub": "From your library",

  // --- V2 Camera -----------------------------------------------------------
  "camera.hintFirst": "Whole page inside the frame",
  "camera.hintFirstSub": "Line up all four edges",
  "camera.hintNext": "Another page?",
  "camera.hintNextSub": "Shoot the next page, or press Done",
  "camera.hintFull": "Six pages is the maximum — press Done",
  "camera.hintFullSub": "The camera won't take a seventh",
  "camera.done": "Done",
  "camera.guiding": "Talking you through it",
  "camera.edgesLocked": "Edges locked · hold still",
  "camera.close": "Close the camera",
  "camera.shutter": "Take the picture",

  // --- V2 Photo picker -----------------------------------------------------
  "pick.title": "Pick from your photos",
  "pick.subtitle": "A photo or a PDF of the sheet · 6 pages maximum",
  "pick.subtitleFull": "That's the six-page maximum",
  "pick.use": "Use the {n} you picked",
  "pick.useNone": "Pick at least one",

  // --- V2 Review -----------------------------------------------------------
  "review.title": "Check they're clear enough",
  "review.subtitle": "Anything blurry can be shot again",
  "review.retake": "Retake",
  "review.addPage": "Add a page",
  "review.onDevice": "The page stays on your phone. Nobody sees it unless you send it.",
  "review.start": "Read it to me",

  // --- V2 Reading ----------------------------------------------------------
  "reading.title": "Reading your sheet…",
  "reading.meta": "{n} pages · about half a minute",
  "reading.metaLong": "{n} pages · this may take a minute or two",

  // --- V2 Chat shell -------------------------------------------------------
  "chat.back": "Back to sheets",
  "chat.sheetLine": "Discharge sheet, {date}",
  "chat.muteSpeaker": "Turn the voice off",
  "chat.unmuteSpeaker": "Turn the voice on",
  "chat.language": "Choose the language",
  "chat.today": "Today",
  "chat.reading": "Reading aloud",
  "chat.readingThis": "Reading this out",

  // --- V2 The briefing -----------------------------------------------------
  "brief.intro": "I've read your sheet. The most important part first.",
  "brief.warnTitle": "With any of these, go back to the hospital now",
  "brief.understandQuestion": "Is that clear?",
  "brief.repeat": "Say it again",
  "brief.understand": "Got it",
  "brief.left": "{n} more to go",
  "brief.end": "That's everything. Hold the bar below and ask me anything.",
  "brief.trackLink": "See the medicines and the visit in Follow-up",

  // --- V2 The bar ----------------------------------------------------------
  "bar.hold": "Hold to talk",
  "bar.holdSub": "· tap to type",
  "bar.listening": "Listening…",
  "bar.listeningSub": "· let go to send",
  "bar.typePlaceholder": "Type a question…",
  "bar.send": "Send",
  "bar.backToVoice": "Switch back to talking",

  // --- V2 The check-in -----------------------------------------------------
  "checkin.question": "Have you had {name} today? The sheet says {printed}.",
  "checkin.took": "Taken",
  "checkin.notYet": "Not yet",
  "checkin.tookReply": "Right, I've noted it. {n} more today.",
  "checkin.tookReplyAll": "Right, I've noted it. That's all of them today.",
  "checkin.notYetReply": "The sheet says: {printed}",

  // --- V2 Follow-up tab ----------------------------------------------------
  "track.title": "Follow-up",
  "track.following": "Following this sheet",
  "track.nextVisit": "Next visit",
  "track.daysAfter": "in {n} days",
  "track.todayMeds": "Today's medicines",
  "track.warnings": "Warning signs ({n})",
  "track.saySigns": "Ask Ming to read them out",
  "appt.directions": "How to get there",

  // --- V2 Dose cards -------------------------------------------------------
  "card.printed": "The sheet says: {text}",
  "dose.left": "{n} left today",
  "dose.done": "All taken today",
  "dose.asNeeded": "Only when there is pain",
  "dose.stopped": "The sheet says this one has stopped",
  "dose.take": "Taken",

  // --- V2 Sheets (the UI kind) ---------------------------------------------
  "sheet.close": "Close",

  // EXEMPT: rules.md section 16 verbatim wording.
  "disclaimer":
    "This tool provides health information reference and support only. It is not medical advice and cannot replace diagnosis or treatment by professional medical staff. If you have health concerns, consult a registered doctor or relevant professional. AI-generated content may be inaccurate.",
  "aiChip": "Written by AI, may be wrong",
  "cautionSuffix": "Written by AI, may be wrong.",
  "agentLimits.title": "What it does and doesn't do",
  "agentLimits.can":
    "It will: read the sheet out, answer questions about what is on the sheet, and count how many doses are left today.",
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
