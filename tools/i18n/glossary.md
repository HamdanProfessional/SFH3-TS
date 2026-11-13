# SFH3 简体中文术语表与翻译规范

翻译、润色和审核都以本文件为准。有冲突时以这里为准，新增术语先补进这里再用。

## 一、总原则

1. 简体中文，口吻是动作射击游戏：简洁、有力、口语化，不要书面腔和翻译腔。
2. **保留英文、不翻译**（输出 `null`）：
   - 武器型号与武器名：AK12、R870、TAC 45、Desert Eagle、Betsy、Vulcan、Katana 等。
   - 人名、角色名、品牌、组织名：Sky9、Mike、Justin、Armor Games、Not Doppler。
   - 以 `$` 开头的字符串（内部 ID，例如 `$class`、`$Desert Eagle`）。
   - 明显不是给玩家看的：CSS、错误堆栈、代码标识符、调试用文字、HTTP 方法名。
   - 纯缩写的单位：DPS、EXP 作单位时可以保留（见术语）。
3. **格式必须原样保留**：
   - 占位符 `{0}` `{1}` …，可以调整顺序，但不能增删。
   - `@`（代码会替换成数字）、`\n` 换行、行首的 `- `、首尾空格（拼接用的片段，例如 `" used killstreak "`）。
   - 数字、`%`、`+`、`-`、`x`（倍数）、`$`（金钱）。
4. **长度**：按钮、标签、表头宽度有限。中文字数尽量不超过英文字符数的一半，越短越好，例如 `CONTINUE` 译为“继续”。说明文字可以正常长度。
5. **标点**：中文句子用全角标点（，。！？：），省略号用“……”。英文原文没有句号的短语，译文也不加句号。数字和百分号之间不加空格。
6. **全大写**的英文在中文里不需要特别处理；原文有感叹号的保留感叹号的语气。
7. 原文拼写错误（Doploy、Embarassed、Aggresion）按正确含义翻译。
8. 玩笑、梗、双关要意译，保留幽默，不要硬直译。
9. **游戏只在显示时替换文字**，代码里拿英文做比较不受影响。所以不要因为“代码里有 `=== "Success!"`”就写 null，照常翻译。
10. 倍数写法：`2x quicker` → “快 2 倍”，`x2` 作标签时保留 “x2”。百分比数值写在前面或后面都行，但同类条目要统一，统一用“属性 +N%”的格式，例如“射速 +25%”“受到的爆头伤害 -15%”。
11. 原文把两段连在一起的（例如 `GlobeX HeadquartersUnknown Location`，是游戏原本的显示问题），译文用“ · ”分开：“GlobeX 总部 · 未知地点”。
12. HTML 标签（`<b>`、`<br>`、`<b style=...>`）原样保留，只翻译标签外的文字。

## 二、术语

### 系统与界面
| 英文 | 中文 | 备注 |
|---|---|---|
| Campaign | 战役 | |
| Mission | 任务 | |
| Daily mission | 每日任务 | |
| Quick match | 快速战斗 | |
| Squad | 小队 | |
| Hero | 英雄 | |
| Unique Hero | 特殊英雄 | 剧情里的特殊角色 |
| Class | 职业 | New Class → 新职业 |
| Hire | 雇佣 | |
| Fire（解雇英雄） | 解雇 | 注意和开火 Fire 区分，看上下文 |
| Deploy | 出击 | |
| Store | 商店 | |
| Inventory | 仓库 | |
| Workshop | 工坊 | |
| Blueprint | 蓝图 | |
| Craft / Build | 制造 | Built → 已制造 |
| Upgrade | 升级 | |
| Slot machine / Slots | 老虎机 | Spin → 转动，Spins → 次数 |
| Funds | 资金 | |
| Gold / Money / Cash（游戏货币） | 资金 | “+15% Gold per kill” → “每次击杀资金 +15%” |
| Detection（被敌人发现） | 隐蔽 | Low Detection → 隐蔽性高，Extremely Low Detection → 极难察觉 |
| Status effect | 异常状态 | |
| Soldier | 士兵 | |
| Prefab / Piece（编辑器） | 预制件 | |
| Prop（编辑器） | 道具 | |
| Waypoint（编辑器） | 路点 | |
| Tile / Cell（编辑器） | 格子 | |
| Undo / Redo | 撤销 / 重做 | |
| Share | 分享 | |
| Day | 天 | “DAY 5” → “第 5 天” |
| Level / LVL / Lv | 等级 / Lv | 窄位置用 Lv，例如 “Lv 30” |
| EXP / Experience | 经验 | |
| Level up | 升级 | LEVEL UP! → 升级了！ |
| Skill / Perk | 技能 | |
| New skill | 新技能 | |
| Medal / Achievement | 勋章 | |
| Options | 选项 | |
| Controls | 操作 | |
| Tips | 提示 | |
| Credits | 制作人员 | |
| Map editor | 地图编辑器 | |
| Custom map | 自定义地图 | |
| Squad code | 小队代码 | |
| Locked | 未解锁 | |

### 职业与状态
| 英文 | 中文 |
|---|---|
| Engineer | 工程兵 |
| Elite | 精英 |
| Juggernaut | 重装兵 |
| Mercenary | 雇佣兵 |
| Sniper（职业） | 狙击手 |
| Ninja | 忍者 |
| Medic | 医疗兵 |
| Gunslinger | 枪手 |
| Knight | 骑士 |
| Tired（英雄状态） | 疲惫 |
| Injured（英雄状态） | 受伤 |
| Critical（英雄状态） | 重伤 |

注意：`Critical Chance` 是暴击率，`Critical Damage` 是暴击伤害，和英雄状态“重伤”不是一回事。

### 技能类型
| 英文 | 中文 |
|---|---|
| UTILITY | 辅助 |
| DEFENSIVE | 防御 |
| OFFENSIVE | 进攻 |
| FLAW | 缺陷 |
| TRAIT | 特性 |
| ATTACHMENT | 配件 |
| KILLSTREAK | 连杀奖励 |
| POOP / Poop | 便便 |

### 武器类别与属性
| 英文 | 中文 |
|---|---|
| Pistol(s) | 手枪 |
| SMG(s) | 冲锋枪 |
| Blade(s) | 刀剑 |
| Rifle(s) | 步枪 |
| Dual(s) | 双持 |
| Sniper(s)（武器类） | 狙击枪 |
| Shotgun(s) | 霰弹枪 |
| Machine Gun(s) | 机枪 |
| Explosive(s) | 爆破武器 |
| Elemental(s) | 元素武器 |
| Experimental(s) | 实验武器 |
| Attachment(s) | 配件 |
| Equipment | 装备 |
| IMPACT / Damage | 威力 / 伤害 |
| FIRE RATE / RoF | 射速 |
| ACCURACY | 精准度 |
| AMMO | 弹药 |
| Range | 射程 |
| Reload | 换弹 |
| Magazine / Mag / Clip | 弹匣 |
| Burst fire | 点射 |
| Headshot | 爆头 |
| Critical chance | 暴击率 |
| Critical damage | 暴击伤害 |
| Recoil | 后坐力 |
| DPS | DPS |

### 武器品质
| 英文 | 中文 |
|---|---|
| BROKEN | 破损 |
| CUSTOM | 定制 |
| REFINED | 精良 |
| FLAWLESS | 完美 |
| PROTOTYPE | 原型 |

### 战斗
| 英文 | 中文 |
|---|---|
| Kill / Kills | 击杀 |
| Death(s) | 阵亡 |
| Killstreak | 连杀奖励 |
| Respawn | 复活 |
| Health | 生命值 |
| Pickup | 补给 |
| Sentry / Turret | 哨戒炮 / 炮塔 |
| Aim Bot | 自瞄 |
| Wall Hack | 透视 |
| Burn / Burning | 燃烧 |
| Chilled | 寒冷 |
| Frozen / Freeze | 冰冻 |
| Poison | 中毒 |
| Stun | 眩晕 |
| Electrocute / Shock | 电击 |
| Spawn（出生点） | 出生点 |
| Bot(s) | 机器人 |

### 模式与计分
| 英文 | 中文 |
|---|---|
| Deathmatch | 死斗 |
| Team Deathmatch / TDM | 团队死斗 |
| Elimination | 歼灭 |
| Team Elimination | 团队歼灭 |
| Capture the Flag / CTF | 夺旗 |
| Domination / DOM | 据点争夺 |
| One Man Army | 一人成军 |
| Outbreak | 感染 |
| Gun Game | 军备竞赛 |
| Team Gun Game | 团队军备竞赛 |
| KILLS（计分） | 击杀 |
| LIVES | 生命 |
| FLAGS | 旗帜 |
| POINTS | 分数 |
| Zone / Holdpoint | 据点 |
| Flag | 旗帜 |

### 难度
| 英文 | 中文 |
|---|---|
| Very Easy | 非常简单 |
| Easy | 简单 |
| Medium | 普通 |
| Hard | 困难 |
| Very Hard | 非常困难 |
| Insane | 疯狂 |
| FUN（任务难度标签） | 娱乐 |

### 联机
| 英文 | 中文 |
|---|---|
| Multiplayer | 联机 |
| Server | 服务器 |
| Room | 房间 |
| Host | 房主 |
| Ready | 准备 |
| Spectate / Watching | 观战 |
| Ranked | 排位 |
| Season | 赛季 |
| Rating | 积分 |
| Placement | 定级赛 |
| Master / Diamond / Platinum / Gold / Silver / Bronze | 大师 / 钻石 / 铂金 / 黄金 / 白银 / 青铜 |
| Clan | 战队 |
| Friend | 好友 |
| Account / Sign in | 账号 / 登录 |
| Ping | 延迟 |
| Win / Draw / Loss | 胜 / 平 / 负 |
| Win rate | 胜率 |
| Co-op | 合作 |
| Private | 私人 |

### 常用按钮
| 英文 | 中文 |
|---|---|
| PLAY | 开始 |
| CONTINUE | 继续 |
| BACK | 返回 |
| CANCEL | 取消 |
| CLOSE | 关闭 |
| OK | 确定 |
| BUY | 购买 |
| SELL | 出售 |
| EQUIP | 装备 |
| TAKE | 收下 |
| DISCARD | 丢弃 |
| COLLECT | 领取 |
| DELETE | 删除 |
| RESET | 重置 |
| DONE | 完成 |
| NEXT | 下一个 |
| PAUSE | 暂停 |
| FIRE（按钮） | 开火 |
| JUMP | 跳跃 |
| SWAP | 切枪 |
| STREAK | 连杀 |
