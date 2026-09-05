# AIx Origin Summit · 香港场 · Checkpoint 2 进度说明

**赛道：** Vital（活域）软医疗 · **队伍：** Fit or Not（产品：Ming Ming · 明明） · **提交人：** Kevin Yue · **提交日期：** 2026 年 9 月 6 日
**仓库：** https://github.com/kevinyu211/mingming.ai · **线上版本：** https://mingming.app（手机打开） · **Checkpoint 1：** `docs/submission/checkpoint-1.md`

## 一、项目一句话

长者（或其子女）用手机拍下医院出院纸，明明用粤语／普通话／英语把纸上的内容**讲成一段对话**——先讲危险讯号，再逐种药讲，每讲一段都问「明唔明？」并等回答；可以随时追问，每句话都能追溯到纸上的原文；涉及改药、停药、判断病情的问题一律在调用模型之前由规则拒答，并指向药剂师或纸上的电话。

## 二、自 Checkpoint 1 以来完成的部分（均已部署到线上并验证）

1. **读纸过程有界、可取消、结果可信**：有效输入即时得到确认，画面显示「送出中／读取中／检查中」与已用时间；服务器为一次读取设定 240 秒总期限，只在剩余时间内做一次 schema 重试；读者取消或离开时，浏览器请求、路由与模型传输一并中止，迟到的结果不能覆盖或归档先前的纸；完整、经校验的卡片集合才会写入本机（次序、来源、事实逐项校验）。
2. **起始页可在同意前选语言**：界面语言（繁／简／英）在同意声明出现之前即可切换，长者不必先读懂一段自己看不懂的文字。
3. **跟进页与对话打通**：明明在跟进页用同一把声音讲出当日要点（「今日仲有 N 次。N 日之後覆診。食咗就撳一下。」，由代码从计数器组成，不经模型）；「我们讲过的」回顾卡记录讲到第几段、读者答了几次明白、几次要求重讲、问了几个问题——把医院流程「不要求」的复述检查放到记录上。
4. **手机语音输入重写**：每次按住只用一个识别引擎；先开麦克风再显示「听住」；等待有上限；失败必有提示。云端转写（OpenAI）为主，浏览器自带识别只作后备。
5. **数据声明与提交文档更正为实际部署的版本**：模型为 Claude Sonnet 5（经 Vercel AI Gateway 的 Anthropic 兼容端点，服务器端强制 JSON schema）；语音输入为「一次一个引擎」；应用内三种语言的数据声明同步更正。
6. **验证（部署提交 `aa6f492`，9 月 5 日）**：1,370 个单元测试全部通过；TypeScript、ESLint、生产构建通过；122 个手机视口浏览器端到端测试；线上问答评测粤语、普通话各 20/20，0 个违禁用语，中位 4–5 秒；线上读纸评测：药物字段完全一致、危险讯号 100%、无凭空新增或遗漏，模型用时约 22 秒（一页英文样张）。

## 三、剩余待完成的部分及计划

- **9 月 6 日路演**：按 `docs/demo-script.md` 的点击清单演示，现场热身（先授权麦克风、提前两分钟问一个问题）。
- **赛后短期**（顺序按价值）：
  1. **一位同意者的真实出院纸**——在护士在场的情况下用其手机读一次；这是目前最大的验证缺口。
  2. 药盒核对——拍下药袋，与纸上的药单比对，指出缺漏。
  3. 「有事想问」按钮——症状匹配纸上危险讯号则读出原句并显示纸上电话；不匹配则如实说纸上没有并仍显示电话。
  4. 次日回访「今日食咗未？」（需通知机制；应用刻意不承诺做不到的提醒）。
  5. 读取提速——只生成所听语言（现时三种语言一并生成），预计读取时间与成本减半；需重新评测后上线。
  6. 面向医院部署时改用香港区域的模型端点。
- **如实说明的限制**：所有样张均为我们自行合成，从未读取过真实出院纸；未经临床人员验证；粤语语音未经母语听众评审；浏览器测试为 Chrome 模拟的 iPhone／Android 视口，非真机 Safari。

## 四、自 Checkpoint 1 以来遇到的技术难点

1. **一次读取可以无限期悬空**：模型传输在困难照片上可能既不返回也不失败，重试会把计时器归零。改为单一服务器期限、只在剩余时间内重试一次、取消时逐层中止（浏览器 → 路由 → 模型传输），并以请求身份守护最终写入，避免迟到结果替换当前的纸。
2. **修辞修复串行拖慢整体**：多张卡片同时命中违禁词过滤时，逐张修复令读取明显变慢。改为最多两路并发、共享十秒上限，超时卡片用固定模板，保持卡片次序与安全检查不变。
3. **文档与代码漂移**：多个开发会话并行推进，提交包中的模型名称与麦克风描述落后于实际部署。以代码为准逐条核对并更正；应用内数据声明与提交文档共用同一份字符串，避免再次分离。
4. **开发机首次网络连接停顿**：本机 Node 进程闲置后的第一次外连需 50–120 秒（curl 不受影响），曾被误判为线上冷启动；评测时先热身再计时，并在文档中记录。

---

# English summary

**Track:** Vital (soft healthcare) · **Team:** Fit or Not (product: Ming Ming · 明明) · **Repo:** https://github.com/kevinyu211/mingming.ai · **Live:** https://mingming.app

**Since Checkpoint 1 (all deployed and verified):** bounded, cancel-safe sheet reading (immediate acknowledgement with honest stages, one 240 s server deadline, one schema retry only with time left, browser-to-provider abort on cancel, only a complete validated card set is stored); interface language selectable before the consent notice; the follow-up screen joined to the conversation (明明 speaks the day's one line composed by code from the counters, and a teach-back recap card records how far the briefing got, how many 明白, how many repeats, what was asked); the phone microphone rewritten as one engine per hold with bounded waits; the data statement and submission pack corrected to the deployed build (Claude Sonnet 5 through the Vercel AI Gateway's Anthropic-compatible endpoint; cloud transcription with the browser engine only as fallback).

**Verification on the deployed commit (5 Sept):** 1,370 unit tests, TypeScript, ESLint and production build green; 122 browser end-to-end tests on phone viewports; live question eval 20/20 in Cantonese and 20/20 in Mandarin with 0 banned terms and a 4–5 s median; live reading eval with exact medicines, 100% warnings, nothing invented or missing, about 22 s of model time on a one-page sheet.

**Remaining:** the 6 Sept pitch; then one consenting family's real sheet with a nurse present (the largest gap), the medicine-box check, a "something's wrong" button routed to the printed warning signs and number, a next-day check-in, generating only the spoken language to halve read time, and a Hong Kong-region model endpoint for a hospital deployment. Honest limits: every sheet is synthetic, no clinician has validated the readings, the Cantonese voice has not been judged by native listeners, and browser tests emulate phones rather than run on real Safari.

**Difficulties met since Checkpoint 1:** reads that neither returned nor failed on hard photographs (fixed with one server deadline and layered aborts guarded by request identity); serial wording repairs slowing whole reads (now two concurrent repairs under a shared ten-second cap with template fallback); documentation drifting from the code across parallel development sessions (reconciled line by line against the code, with the in-app statement and the pack sharing one set of strings); and a development-machine first-connection stall of 50–120 s that was briefly mistaken for a production cold start.
