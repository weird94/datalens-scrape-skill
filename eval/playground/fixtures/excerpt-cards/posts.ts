/**
 * 演练场 excerpt-cards 的帖子数据与文案（确定性生成）。单独成文件是因为 Next.js 的 route.ts 只允许导出
 * GET / POST 等处理函数和路由配置项，多导出一个函数会让生产构建（`next build` 的路由类型检查）失败。
 */

export type Lang = 'zh' | 'en'

export interface Copy {
  title: string
  heading: string
  /** 摘要里作者名后面的冒号。 */
  colon: string
  open: string
  close: string
  upvote: (count: number) => string
  comments: (count: number) => string
  posted: (date: string) => string
  end: string
  loading: string
  writers: string[]
  badges: string[]
  topics: string[]
  sentences: string[]
  /** 一句话的短回答（比截断长度短）。 */
  oneLiners: string[]
  /** 摘要截断长度（按转义后的 HTML 字符数）。 */
  cut: number
}

export const COPY: Record<Lang, Copy> = {
  zh: {
    title: '推荐（就地展开的卡片）',
    heading: '推荐',
    colon: '：',
    open: '展开阅读',
    close: '收起',
    upvote: (count) => `点赞 ${count}`,
    comments: (count) => `${count} 条评论`,
    posted: (date) => `发表于 ${date}`,
    end: '没有更多了',
    loading: '加载中…',
    writers: ['林木', '周舟', '许一', '陈默', '白鹭', '江北', '何夕', '苏禾', '方圆', '叶知秋', '程远', '沈星'],
    badges: ['数码区作者', '认证用户', '精选'],
    topics: ['为什么冬天火车更容易晚点？', '蜜蜂是怎么认路回家的？', '打字快到底值不值得练？', '面包为什么会发起来？', '海水为什么是咸的？', '降噪耳机是怎么工作的？'],
    sentences: [
      '先说结论，这件事比大多数人想的要简单。',
      '我在这个行业做了八年，见过太多类似的情况。',
      '最关键的一点是温度，其他因素都是次要的。',
      '很多人忽略了成本，其实成本才是决定性的。',
      '举个例子，去年我们团队就遇到过一模一样的问题。',
      '说到底，经验和耐心比工具更重要。',
      '如果只记住一句话，那就是先测量再动手。',
      '最后补充一点，别被表面的数字迷惑。',
    ],
    oneLiners: ['说得对，先把基础打牢再说吧', '别急，慢慢来反而比较快', '我也遇到过，换个时间就好了'],
    cut: 48,
  },
  en: {
    title: 'For you (cards that open in place)',
    heading: 'For you',
    colon: ': ',
    open: 'Read more',
    close: 'Show less',
    upvote: (count) => `Upvote ${count}`,
    comments: (count) => `${count} comments`,
    posted: (date) => `Posted ${date}`,
    end: 'No more posts',
    loading: 'Loading…',
    writers: ['Ana Lee', 'Bo Chen', 'Cara Diaz', 'Dev Rao', 'Eli Moss', 'Fay Kim', 'Gus Hart', 'Ida Park', 'Jon Vale', 'Kai Rowe', 'Lia Ford', 'Max Bell'],
    badges: ['Top writer', 'Science contributor', "Editors' pick"],
    topics: ['Why do trains run late in winter?', 'How do bees find their way home?', 'Is it worth learning to type fast?', 'What makes bread rise?', 'Why is the sea salty?', 'How do noise-cancelling headphones work?'],
    sentences: [
      'Short version: it is simpler than most people think.',
      'I have worked in this field for eight years and seen this many times.',
      'The key factor is temperature; everything else comes second.',
      'Most people ignore the cost, and the cost is what decides it.',
      'Last year our team ran into exactly the same problem.',
      'In the end, patience matters more than the tools.',
      'If you remember one thing, measure before you change anything.',
      'One more point: do not trust the headline numbers.',
    ],
    oneLiners: ['Yes, if you enjoy it.', 'Slow is smooth, smooth is fast.', 'Same here, try it again later.'],
    cut: 90,
  },
}

export interface ExcerptPost {
  id: number
  title: string
  link: string
  writer: string
  writerLink: string
  avatar: string
  badge: string
  /** 完整正文，HTML 已转义。 */
  html: string
  /** 折叠时的摘要：「<作者><冒号><转义后正文的前 cut 个字符>…」（每第 10 篇的短回答不带「…」）。 */
  excerpt: string
  posted: string
  upvotes: number
  comments: number
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 帖子数据，确定性生成（同一组参数每次一样）。 */
export function excerptPosts(total: number, lang: Lang): ExcerptPost[] {
  const copy = COPY[lang]
  const posts: ExcerptPost[] = []
  for (let index = 0; index < total; index += 1) {
    const id = index + 1
    const writer = copy.writers[index % copy.writers.length]
    const oneLiner = id % 5 === 0
    const plain = oneLiner
      ? copy.oneLiners[(id / 5 - 1) % copy.oneLiners.length]
      : [0, 1, 2, 3].map((offset) => copy.sentences[(index + offset * 3) % copy.sentences.length]).join(lang === 'zh' ? '' : ' ')
    // 每第 4 篇的正文里有「&」，放在截断点前两个字符：摘要按转义后的 HTML 截断，截断点落在「&amp;」中间。
    const ampersandAt = copy.cut - 2
    const text = id % 4 === 0 && !oneLiner ? `${plain.slice(0, ampersandAt)}&${plain.slice(ampersandAt)}` : plain
    const html = escapeHtml(text)
    const writerNumber = (index % copy.writers.length) + 1
    posts.push({
      id,
      title: `${copy.topics[index % copy.topics.length]} #${id}`,
      link: `/dev-fixtures/playground/excerpt-cards/post/${id}`,
      writer,
      writerLink: `/dev-fixtures/playground/excerpt-cards/people/${writerNumber}`,
      avatar: `/dev-fixtures/playground/excerpt-cards/avatar/${writerNumber}.png`,
      badge: id % 3 === 0 ? copy.badges[index % copy.badges.length] : '',
      html,
      excerpt: id % 10 === 0 ? `${writer}${copy.colon}${html}` : `${writer}${copy.colon}${html.slice(0, copy.cut)}…`,
      posted: `2026-11-${String(1 + (index % 28)).padStart(2, '0')} ${String(8 + (index % 12)).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')}`,
      upvotes: 10 + index * 13,
      comments: (index * 5) % 37,
    })
  }
  return posts
}
