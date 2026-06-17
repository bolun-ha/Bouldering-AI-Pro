/**
 * 抱石知识库
 * 错误 → 实操纠正对照表
 * 自动注入到 AI 系统提示词，确保每次分析都带具体纠偏建议
 */

export interface ErrorKnowledge {
  code: string;          // 编号（与 E 体系对齐，无编号的可新增）
  name: string;          // 错误名称
  aliases: string[];     // 别名（MediaPipe 检测标签等）
  brief: string;         // 一句话识别
  correction: string[];  // 实操纠正步骤
  priority: 'high' | 'medium' | 'low';
}

export const CLIMBING_KNOWLEDGE: ErrorKnowledge[] = [
  // ═══════════════════════════════════════════
  // 一、肩背 & 手臂错误
  // ═══════════════════════════════════════════
  {
    code: 'E18',
    name: '鸡翅膀（外翻肘）',
    aliases: ['肘外扩', 'chicken wing', 'elbow flare'],
    brief: '大臂向外打开，手肘朝外/后撇，肩膀耸起，大臂远离躯干',
    correction: [
      '优先把胯部贴紧岩壁，收回外探的身体，从根源减少手肘外展',
      '有意识收大臂，让手肘朝向身体中线，不要向外翻',
      '外侧岩点尽量转体调整站位，不要硬伸手臂够点',
    ],
    priority: 'high',
  },
  {
    code: 'E02',
    name: '手臂锁死（持续屈臂/锁肘）',
    aliases: ['臂锁死', 'locked arm', 'continuous bend'],
    brief: '手肘朝内折死不放松，大臂贴近躯干，全程靠臂力吊住身体',
    correction: [
      '每踩稳一个支点，刻意把手臂慢慢伸直，用骨头挂住身体',
      '牢记：蹬腿再伸手，用腿部发力带动身体，而非手臂硬拉',
      '刻意练习"屈臂发力移动，直臂站稳休息"的节奏',
    ],
    priority: 'high',
  },
  {
    code: 'E06',
    name: '耸肩',
    aliases: ['shoulder shrug', 'shoulder elevation'],
    brief: '抓点/发力时肩膀向上抬起贴近耳朵，双肩全程紧绷无法下沉',
    correction: [
      '预备姿态刻意沉肩，双肩向下远离耳朵',
      '每抓稳一个岩点，停顿1秒感受肩膀放松',
      '进阶练习：靠墙站立，双肩贴墙，模拟抓点动作，养成沉肩习惯',
    ],
    priority: 'high',
  },
  {
    code: 'E19',
    name: '含胸驼背',
    aliases: ['hunch', 'rounded back'],
    brief: '胸口内收、后背拱起，上半身蜷缩，无法贴紧岩壁',
    correction: [
      '收紧核心，胸口微微向前送，腰背保持一条直线',
      '攀爬时刻意让胸口朝向岩壁，不要低头蜷缩',
      '简单训练：平地站姿挺胸收腹，反复模仿攀爬上半身姿态',
    ],
    priority: 'medium',
  },
  {
    code: 'E20',
    name: '架肘/顶肘',
    aliases: ['elbow up', 'elbow lift'],
    brief: '手肘向上顶起架高，大臂与身体呈90°以上（区别于鸡翅膀的外撇）',
    correction: [
      '大臂贴紧躯干，手肘自然朝下',
      '够远岩点优先转体，不抬肘硬够',
    ],
    priority: 'medium',
  },

  // ═══════════════════════════════════════════
  // 二、转体 & 胯部动作错误
  // ═══════════════════════════════════════════
  {
    code: 'E05',
    name: '胯部外顶/撅屁股',
    aliases: ['臀部远墙', 'hip far from wall', 'butt out'],
    brief: '臀部向后突出，胯部远离岩壁，整个人挂在岩壁外，仅手臂承重',
    correction: [
      '口诀：收胯、贴岩，主动把胯往岩壁方向靠',
      '单侧够点时，同侧胯部顶向岩壁，用身体侧面贴岩分担重量',
      '练习：静态贴岩，手脚抓踩稳定后，保持胯部贴岩30秒',
    ],
    priority: 'high',
  },
  {
    code: 'E21',
    name: '不会转体',
    aliases: ['lack of twist', 'square on wall'],
    brief: '岩点在侧面/斜上方，身体正面始终朝岩壁，单纯伸长手臂去够',
    correction: [
      '遵循转体优先于伸手：想去哪一侧，身体就转向哪一侧',
      '例：右侧有岩点→右脚踩稳，身体向右转，再出手抓点',
      '慢动作练习路线，每移动一次就调整身体朝向',
    ],
    priority: 'high',
  },
  {
    code: 'E22',
    name: '扭腰代偿',
    aliases: ['waist twist', 'lower back torque'],
    brief: '手脚位置不对称时，靠腰部强行扭转借力，而非转胯转髋',
    correction: [
      '扭转发力点放在髋部，腰部保持稳定不拧动',
      '需要侧向发力时，主动转胯替代扭腰',
    ],
    priority: 'medium',
  },

  // ═══════════════════════════════════════════
  // 三、脚部全套错误
  // ═══════════════════════════════════════════
  {
    code: 'E23',
    name: '脚跟悬空/踮脚',
    aliases: ['heel up', 'tiptoe', 'ball climb'],
    brief: '全程只用鞋尖搭点，脚跟抬起，脚踝紧绷，脚部晃动',
    correction: [
      '踩点原则：能全掌踩不全掌踩，不能就前掌踩，脚跟尽量下沉',
      '小支点：前脚掌压实岩面，脚跟微微下放，不要刻意上翘',
      '静态练习：单脚踩支点，保持脚跟落地，坚持20秒/组',
    ],
    priority: 'high',
  },
  {
    code: 'E24',
    name: '高抬脚',
    aliases: ['high knee', 'overlift'],
    brief: '为够高点支点大腿大幅抬起，膝盖抬到胸口附近，重心上抬失衡',
    correction: [
      '优先屈膝折髋，用髋关节折叠代替抬高整条腿',
      '高点支点分步移动，不要一步到位',
    ],
    priority: 'medium',
  },
  {
    code: 'E12',
    name: '挂脚错误',
    aliases: ['heel hook error', 'toe hook error', '挂脚'],
    brief: '挂脚时只用脚尖勾点、腿部僵硬，或整只脚胡乱搭在岩面上',
    correction: [
      '用脚弓/鞋侧橡胶勾住岩点，腿部微微发力绷紧',
      '借助挂脚把身体拉向岩壁，不是单纯搭在上面',
    ],
    priority: 'medium',
  },
  {
    code: 'E25',
    name: '交叉脚混乱',
    aliases: ['crossed feet', 'foot tangle'],
    brief: '换脚时双脚交叉缠绕、站位拥挤，下一步无法落脚',
    correction: [
      '换脚保持双脚前后/左右分立，预留移动空间',
      '不交叉叠脚，提前规划下一步的落脚位置',
    ],
    priority: 'medium',
  },

  // ═══════════════════════════════════════════
  // 四、手部 & 抓握补充错误
  // ═══════════════════════════════════════════
  {
    code: 'E26',
    name: '吊手/沉腕',
    aliases: ['wrist drop', 'cocked wrist'],
    brief: '抓点时手腕向下耷拉，手背高于手指，手腕反向弯折',
    correction: [
      '手腕保持中立位，和小臂呈一条直线',
      '不向上翘、不向下沉，保持刚性连线',
    ],
    priority: 'high',
  },
  {
    code: 'E27',
    name: '手指分力不均',
    aliases: ['single finger', 'uneven load'],
    brief: '抓小点时部分手指悬空，仅1-2根手指承重',
    correction: [
      '尽量让所有手指均匀贴合岩点',
      '小点优先用指勾，不强行单指抠点',
    ],
    priority: 'medium',
  },
  {
    code: 'E08',
    name: '抓点过满/把岩点抓死',
    aliases: ['death grip', 'over-grip', '抓点过紧'],
    brief: '手掌完全包裹岩点，手指抠到岩点底部，手腕被迫弯折',
    correction: [
      '浅抓岩点上沿，保留手腕活动空间',
      '放松到"刚好不掉"的力度，不要死攥',
    ],
    priority: 'medium',
  },

  // ═══════════════════════════════════════════
  // 五、核心与发力节奏错误
  // ═══════════════════════════════════════════
  {
    code: 'E07',
    name: '核心不收/塌腰',
    aliases: ['core off', 'sagged back'],
    brief: '身体悬挂时腰部自然下坠，躯干软塌，没有支撑力',
    correction: [
      '攀爬全程微收核心（像收腹憋气的轻力度状态）',
      '静态悬挂练习：手脚抓稳，收紧核心，保持腰背平直30秒',
    ],
    priority: 'high',
  },
  {
    code: 'E28',
    name: '发力顺序颠倒',
    aliases: ['arms first', '先伸手后蹬腿'],
    brief: '先伸长手臂抓点，再蹬腿起身，手臂全程弯曲承重',
    correction: [
      '口诀：先蹬腿，再出手',
      '慢动作分解：脚发力蹬起→身体升高→手臂顺势抓点',
      '刻意练习：每一步都先感受腿部蹬踏的力量',
    ],
    priority: 'high',
  },
  {
    code: 'E17',
    name: '动作断续/猛冲猛停',
    aliases: ['rhythm error', 'jerky movement', '节奏问题'],
    brief: '发力忽快忽猛，移动时全身晃动，没有连贯节奏',
    correction: [
      '一停一动，站稳再移动',
      '发力匀速，拒绝突然猛拉猛蹬',
    ],
    priority: 'medium',
  },

  // ═══════════════════════════════════════════
  // 六、视线与头部姿态
  // ═══════════════════════════════════════════
  {
    code: 'E10',
    name: '低头盯脚',
    aliases: ['head down', 'staring at feet', '视线错误'],
    brief: '眼睛一直盯着脚下支点，完全不看上方路线',
    correction: [
      '起步前整体观察整条路线',
      '攀爬时视线看向前方/上方支点，用余光留意脚下',
    ],
    priority: 'medium',
  },
  {
    code: 'E29',
    name: '仰头过度',
    aliases: ['head back', 'neck hyperextension'],
    brief: '头部大幅后仰，脖子紧绷看顶端岩点',
    correction: [
      '下巴微收，视线平视斜上方',
      '靠转体调整视角，不硬仰头',
    ],
    priority: 'low',
  },

  // ═══════════════════════════════════════════
  // 七、移动逻辑 & 手脚配合
  // ═══════════════════════════════════════════
  {
    code: 'E30',
    name: '同手同脚（顺拐）',
    aliases: ['same side', 'homonimous'],
    brief: '同侧手脚同步移动（左手+左脚一起抬），重心偏移',
    correction: [
      '强制对角配合：左手配右脚，右手配左脚',
      '平地模拟行走，刻意练习对角手脚移动，形成肌肉记忆',
    ],
    priority: 'high',
  },
  {
    code: 'E31',
    name: '频繁换手/抓点犹豫',
    aliases: ['over-grip adjust', 'hand fidget'],
    brief: '抓稳支点后反复换手、调整抓握位置，身体不停晃动',
    correction: [
      '出手前预判抓点位置，一抓到位',
      '非必要不二次调整，节省体力',
    ],
    priority: 'low',
  },

  // ═══════════════════════════════════════════
  // 八、落地安全
  // ═══════════════════════════════════════════
  {
    code: 'E32',
    name: '直腿落地',
    aliases: ['straight leg landing', 'locked knee landing'],
    brief: '落地双腿完全伸直，无弯曲缓冲，冲击力直传膝盖腰椎',
    correction: [
      '落地瞬间主动屈膝下蹲',
      '前脚掌先触垫，再全脚落地',
    ],
    priority: 'high',
  },
  {
    code: 'E33',
    name: '侧身/单脚落地',
    aliases: ['single foot landing', 'twisted landing'],
    brief: '身体扭转、单脚先落地，重心偏向一侧',
    correction: [
      '下落时身体转正，双脚同时落地',
      '重心居中，不要偏向任何一侧',
    ],
    priority: 'high',
  },
  {
    code: 'E34',
    name: '后仰落地',
    aliases: ['back landing', 'butt landing'],
    brief: '脱落时身体后仰，臀部先砸垫子',
    correction: [
      '脱落时微微收腹，身体前倾',
      '双脚优先落地，不要屁股先着地',
    ],
    priority: 'high',
  },
  {
    code: 'E35',
    name: '慌乱用手撑地',
    aliases: ['hand brace fall', 'arm catch'],
    brief: '失衡时下意识手掌撑垫，手腕手肘容易挫伤骨折',
    correction: [
      '牢记"脚先落地，手不硬撑"',
      '实在不稳可顺势团身侧滚',
    ],
    priority: 'high',
  },
];

/**
 * 根据别名查找知识条目（用于 MediaPipe 检测标签 → 知识库映射）
 */
export function findKnowledge(aliasOrName: string): ErrorKnowledge | undefined {
  const key = aliasOrName.toLowerCase();
  return CLIMBING_KNOWLEDGE.find(
    k => k.name.toLowerCase() === key
      || k.code.toLowerCase() === key
      || k.aliases.some(a => a.toLowerCase() === key)
  );
}

/**
 * 生成 AI Prompt 可用的知识库文本
 */
export function buildKnowledgePrompt(): string {
  const sections: { title: string; items: ErrorKnowledge[] }[] = [
    { title: '肩背 & 手臂', items: CLIMBING_KNOWLEDGE.filter(k => ['E02','E06','E18','E19','E20'].includes(k.code)) },
    { title: '转体 & 胯部', items: CLIMBING_KNOWLEDGE.filter(k => ['E05','E21','E22'].includes(k.code)) },
    { title: '脚部', items: CLIMBING_KNOWLEDGE.filter(k => ['E12','E23','E24','E25'].includes(k.code)) },
    { title: '手部 & 抓握', items: CLIMBING_KNOWLEDGE.filter(k => ['E08','E26','E27'].includes(k.code)) },
    { title: '核心与发力节奏', items: CLIMBING_KNOWLEDGE.filter(k => ['E07','E17','E28'].includes(k.code)) },
    { title: '视线与头部', items: CLIMBING_KNOWLEDGE.filter(k => ['E10','E29'].includes(k.code)) },
    { title: '手脚配合', items: CLIMBING_KNOWLEDGE.filter(k => ['E30','E31'].includes(k.code)) },
    { title: '落地安全', items: CLIMBING_KNOWLEDGE.filter(k => ['E32','E33','E34','E35'].includes(k.code)) },
  ];

  let text = '\n\n## 抱石实操知识库\n每次识别到错误后，必须从以下知识库引用对应的纠正建议：\n\n';
  for (const section of sections) {
    text += `### ${section.title}\n`;
    for (const item of section.items) {
      text += `**${item.code} ${item.name}**：${item.brief}\n`;
      text += `  纠正步骤：\n`;
      for (const step of item.correction) {
        text += `    • ${step}\n`;
      }
      text += '\n';
    }
  }
  text += '**要求**：报告中识别到某个错误时，必须引用知识库中的纠正建议。直接引用具体步骤（如"● 优先把胯部贴紧岩壁"），不要笼统说"建议改进"。\n';

  return text;
}

export default CLIMBING_KNOWLEDGE;
