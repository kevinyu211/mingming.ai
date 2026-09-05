# AIx Origin Summit · 香港场 · Checkpoint 1 进度说明

**赛道：** Vital（活域）软医疗 · **队伍：** Ming Ming · 明明 · **提交人：** Kevin Yue · **提交日期：** 2026 年 9 月 5 日
**仓库：** https://github.com/kevinyu211/discharge-sheet-agent · **线上版本：** https://mingming.app（手机打开）

## 一、项目一句话

长者（或其子女）用手机拍下医院出院纸，明明用粤语／普通话／英语把纸上的内容**讲成一段对话**——先讲危险讯号，再逐种药讲，每讲一段都问「明唔明？」并等回答；可以随时追问，每句话都能追溯到纸上的原文；涉及改药、停药、判断病情的问题一律拒答并指向药剂师或纸上的电话。

## 二、已完成的部分（均已部署并在线上验证）

1. **读纸**：拍照或上传最多 6 页 → 模型结构化读取（药名、剂量、频次、状态、危险讯号、复诊、饮食）→ 规则层排序（危险讯号永远最先）→ 每张卡片附带纸上原句。渲染版样张 30–50 秒，真实照片约 45 秒，严重模糊／遮挡的压力测试照片约 3.5 分钟且结果正确（不可读的格子标为「读不到」而非猜测）。
2. **对话式讲解**：一段一个气泡（引导语＋纸上内容＋提问），明明**等待读者回答**「明白／再讲一次」才继续；每种药单独一轮；读者可随时打断提问。
3. **问答与边界**：三类回答——纸上有的（引用卡片）、通用解释（如「空腹是什么意思」，明确标注非纸上内容）、边界回复（个人化判断交给医生，然后只读出纸上印着的危险讯号）。改药／停药／加药问题在调用模型之前由规则直接拒答；危机语句触发转介。最近一次线上评测：20/20 题结果正确，0 个违禁用语，答复中位 4 秒。
4. **语音**：MiniMax `speech-2.8-hd` 粤语／普通话／英语三种声音；OpenAI 转写；按住说话，松开发送；麦克风状态诚实显示（开启中／听住／送出中）。
5. **跟进页**：今日各药剩余次数（只数「次」，绝不生成钟点）、复诊倒数（只在纸上印有日期时显示）、危险讯号、家人分享；明明在此页用同一把声音说出当日要点，并有「我们讲过的」回顾卡（读者答了几次明白、几次要求重讲、问了几个问题）。
6. **隐私与安全**：所有数据只存手机本地；照片读完即弃；一键清除；服务器只转发请求，不记录内容；违禁用语过滤；数据声明与伦理说明见 `docs/submission/`。
7. **工程质量**：1,300+ 单元测试、116 个真机浏览器端到端测试、三份合成样张的读取评测、20 题问答评测、压力照片评测；备用演示视频（一镜到底真实操作）已录制。

## 三、剩余待完成的部分及计划

- **9 月 6 日路演前**：现场热身（麦克风授权一次、提前两分钟问一个问题）、按最终版讲稿彩排（`docs/demo-script.md`）。
- **赛后短期**：
  1. 药盒核对——拍下药袋，与纸上的药单比对，指出缺漏（价值最高）。
  2. 「有事想问」按钮——症状匹配纸上危险讯号则读出原句并显示纸上电话；不匹配则如实说纸上没有并仍显示电话（只做动作引导，不做诊断）。
  3. 次日回访——第二天主动问「今日食咗未？」（需通知机制，目前应用刻意不承诺做不到的提醒）。
  4. 读取提速——读取输出中约一半是未被朗读的另外两种语言，改为只生成所听语言可将读取时间和成本减半（需重新评测后才上线）。
- **验证缺口（如实说明）**：所有样张均为我们自行合成；从未读取过真实出院纸。下一步是取得一位同意者的真实纸张做验证。

## 四、遇到的技术难点

1. **模型传输层切换导致真实照片读取失败**：将模型调用迁移到 Vercel AI Gateway 后，渲染样张正常但所有真实照片被判「读不到」。根因有二——新路径不在服务端强制 JSON schema，且未传 `effort` 参数；修法是将 Anthropic 模型经 Gateway 的兼容端点发送与基线完全一致的请求（schema 强制＋effort medium）。
2. **困难照片耗尽 token 预算**：严重模糊照片上模型「思考」占满 16k 输出上限，回复被截断；重放请求定位后改为读取用 64k 上限、单次尝试、280 秒预算。
3. **手机端语音输入**：iOS 上麦克风尚未打开界面已显示「听住」，首句丢失；一次卡住的录音让之后所有按住都失效；两个识别引擎争用一个麦克风。重写为单引擎、状态诚实、超时有界、失败必有提示。
4. **语音供应商预付额度**：MiniMax 余额耗尽时以 HTTP 200 返回错误体，应用如实降级为文字；现已在日志中记录错误码并对瞬时拒绝重试一次。
5. **多人协作同一工作树**：多个开发会话共用一份代码检出，曾三次误删未提交工作；改为按路径提交、隔离工作树验证后再推送。

---

# English summary

**Track:** Vital (soft healthcare) · **Team:** Ming Ming · 明明 · **Repo:** https://github.com/kevinyu211/discharge-sheet-agent · **Live:** https://mingming.app

**Done (deployed and verified):** photograph/upload a discharge sheet (up to 6 pages) → structured reading with warning signs first and every card traceable to a printed line → a turn-taking spoken briefing in Cantonese/Mandarin/English that waits for 「明白」 → questions answered from the sheet, general terms explained with a label, personal judgements handed to the doctor, medicine-change questions refused before any model call (last live eval 20/20, 0 banned terms, ~4 s median) → hold-to-talk voice in/out → a follow-up screen with dose counters (frequencies, never clock times), the appointment countdown, warning signs, family share, 明明's spoken summary and a teach-back recap. On-device storage only; 1,300+ unit tests, 116 browser e2e tests, fixture and stress evals, a continuous real-run backup video.

**Remaining:** rehearsal for the 6 Sept pitch; afterwards medicine-box check against the sheet, a "something's wrong" button routing to printed warning signs and the printed number, a next-day check-in, and halving read time by generating only the spoken language. Honest gap: every sheet tested is synthetic; a consenting family's real sheet is the next validation.

**Difficulties met:** photo reads broke when the model transport moved to the Vercel AI Gateway (no server-side schema enforcement, effort not sent) — fixed via the Gateway's Anthropic-compatible endpoint with the baseline request; degraded photos exhausted the 16k token budget in thinking — reads now 64k/one attempt/280 s; iOS microphone timing and engine contention — rewritten as one engine with honest states and bounded waits; prepaid TTS balance exhaustion returned inside HTTP 200 — now logged and retried once; several agents sharing one working tree — commit-by-path and isolated verification worktrees.
