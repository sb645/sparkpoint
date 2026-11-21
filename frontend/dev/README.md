# 前端联调替身

成员 2 交付正式状态机前，`frontend/app.js` 可从 `./dev/mock-contract.js` 导入 `initialState`、`transition`、`addMinutes` 和 `PHASES`，本地跑通两种合同。
正式模块到位后，将该导入路径换成 `../backend/contract.js`。姿势和清醒判定以成员 3 的 `backend/judge.js` 为准。

在仓库根目录运行 `node --test frontend/dev/`。目录内的 `package.json` 指向测试入口，无需安装依赖。看到 `fail 0` 即表示测试全部通过。
