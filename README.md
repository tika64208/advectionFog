# 雾境 — 平流雾智能预测系统

基于多因子加权评分模型的平流雾（Advection Fog）概率预测工具，提供 Web 版和微信小程序版。

气象数据来源于 [Open-Meteo](https://open-meteo.com/) 免费 API，地理编码使用 [Nominatim](https://nominatim.openstreetmap.org/)。

## 功能

- **实时预测** — 输入城市名称或使用定位，获取当前平流雾概率及等级
- **逐时预报** — 未来 24 小时逐时雾概率趋势
- **概率地图** — 以当前位置为中心，展示周边区域平流雾概率分布
- **历史记录** — 保存查询历史，方便回顾对比

## 预测算法

采用 6 因子加权评分模型，总分 100：

| # | 因子 | 权重 | 说明 |
|---|------|------|------|
| 1 | 温度-露点差 (T-Td) | 35% | 越小越接近饱和 |
| 2 | 相对湿度 | 25% | 水汽充沛程度 |
| 3 | 风速 | 20% | 2-7 m/s 最利于平流雾 |
| 4 | 温度趋势 | 10% | 未来 6h 降温有利于成雾 |
| 5 | 风向稳定性 | 10% | 圆统计 mean resultant length |
| 6 | 平流蓄积前兆 | 附加 +0~8 | 强风高湿 + 即将减弱 → 预警 |

等级阈值：≥70 高概率 · ≥45 中概率 · <45 低概率

算法详细演进过程见 [ALGORITHM_CHANGELOG.md](ALGORITHM_CHANGELOG.md)。

## 项目结构

```
├── index.html              # Web 版页面
├── app.js                  # Web 版逻辑
├── style.css               # Web 版样式
├── ALGORITHM_CHANGELOG.md  # 算法版本演进记录
└── miniprogram/            # 微信小程序版
    ├── app.js / app.json / app.wxss
    ├── utils/
    │   ├── fog-calculator.js   # 核心预测算法
    │   ├── api.js              # API 调用封装
    │   └── cities.js           # 内置城市数据库
    └── pages/
        ├── index/              # 首页（城市搜索）
        ├── result/             # 预测结果
        ├── fogmap/             # 概率地图
        └── history/            # 历史记录
```

## 使用方式

### Web 版

直接用浏览器打开 `index.html` 即可，无需构建。

### 微信小程序版

1. 下载 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 导入 `miniprogram/` 目录
3. 在开发者工具中配置合法域名：
   - `https://api.open-meteo.com`
   - `https://nominatim.openstreetmap.org`
4. 编译运行

## 数据来源

| 服务 | 用途 | 费用 |
|------|------|------|
| [Open-Meteo](https://open-meteo.com/) | 气象数据（温度、湿度、风速等） | 免费 |
| [Nominatim](https://nominatim.openstreetmap.org/) | 地理编码（城市名 ↔ 坐标） | 免费 |

## License

MIT
