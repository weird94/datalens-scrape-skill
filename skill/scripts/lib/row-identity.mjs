// Which cell values say nothing about which record a row is: values that change while the same record
// stays on the page (a count, a price, a clock, "3 hours ago") and pictures (lazy-loaded, swapped for
// another size). The collector leaves them out when it recognises a row read again.
//
// Ported from the extension's collector (copilot-services/src/execution/key-field-utils.ts,
// isNumericLikeRowText), where it was tuned on real sites and a 125-list gold set.
//
// Self-contained like collectOnPage (no imports, nothing from module scope): collect.mjs ships it as
// source to the user's Chrome next to the collector.
export function rowIdentity() {
  /**
   * Decoration allowed in a number: spaces (incl. no-break / narrow), signs, decimal and thousands marks
   * (incl. Arabic ٫ ٬), percent (incl. ٪), brackets, colon (clocks, scores), currency symbols, bidi marks
   * around digits on RTL pages, and their full-width forms.
   */
  const NUMERIC_DECORATION = /[\s+\-−±.,'’%‰٪٫٬():\p{Sc}‎‏؜‪-‮⁦-⁩＋－．，％：（）]/gu
  const DIGIT = /\p{Nd}/u
  const DIGITS = /\p{Nd}/gu
  /** Digit-dash-digit (2024-01-03, 10-20): the record's own date or range, not a live value. */
  const DIGIT_DASH_DIGIT = /\p{Nd}[-−–－]\p{Nd}/u
  /** 1–3 letters glued to a currency symbol (HK$, US$, R$, NT$): part of the symbol. */
  const CURRENCY_LETTER_PREFIX = /^\p{L}{1,3}(?=\s?\p{Sc})/u
  /** A word before the number (dots allowed): part of it when it is a currency code ("USD 12.99", "Rs. 1,234"). */
  const LEADING_WORD = /^([\p{L}\p{M}][\p{L}\p{M}.]*)\s*/u
  const BARE_DIGITS = /^\p{Nd}+$/u
  const SPACE_SEPARATED_DIGIT_GROUPS = /^\p{Nd}+(?:\s\p{Nd}+)+$/u
  const SPACE_THOUSANDS_GROUPING = /^\p{Nd}{1,3}(?:\s\p{Nd}{3})+$/u
  const LEADING_ZERO = /^[0０٠۰]/u
  const DIGIT_RUN = /\p{Nd}+(?:[.,'’٫٬，．\s]\p{Nd}+)*/gu
  const DIGIT_RUN_SEPARATOR = /[^\p{Nd}]/gu
  const THOUSANDS_ONLY_SEPARATOR = /^[\s'’٬]$/u
  const DECIMAL_ONLY_SEPARATOR = '٫'
  /**
   * A bare integer this long reads as an identifier (SKU, ISBN, order number, postcode). Years (4 digits)
   * are left out on purpose: Chinese sites show counts under 10,000 as they are ("2024" likes).
   */
  const IDENTIFIER_MIN_BARE_DIGITS = 5
  const LEADING_ZERO_IDENTIFIER_MIN_DIGITS = 2
  /** A magnitude right after the digits: only a quantity is rounded to thousands / 万 / millions. */
  const LATIN_MAGNITUDE_SUFFIX = /^(?:[KkMBT]|bn|Bn|mn|Mn|mln|mld|Mio|Mrd|Md|Tsd|tys|mil|mill|lakh|Lakh|crore|Cr)(?!\p{L})/u
  const UNSPACED_MAGNITUDE_SUFFIX = /^(?:[千万萬亿億兆천만억조]|พัน|หมื่น|แสน|ล้าน)/u
  const MAGNITUDE_WORDS = new Set([
    'thousand', 'million', 'millions', 'billion', 'billions', 'trillion',
    'tausend', 'millionen', 'milliarde', 'milliarden', 'mille', 'milliers', 'milliard', 'milliards',
    'mil', 'millón', 'millones', 'milhão', 'milhões', 'bilhão', 'bilhões', 'mila', 'milione', 'milioni',
    'miliardo', 'miliardi', 'miljoen', 'miljard', 'miljon', 'miljoner', 'tysiąc', 'tysiące', 'tysięcy',
    'milion', 'miliony', 'milionów', 'тыс', 'тысяч', 'тысячи', 'млн', 'млрд', 'тис', 'bin', 'milyon',
    'milyar', 'rb', 'ribu', 'jt', 'juta', 'nghìn', 'ngàn', 'triệu', 'tỷ', 'हज़ार', 'हजार', 'लाख',
    'करोड़', 'ألف', 'آلاف', 'مليون', 'مليار', 'هزار', 'میلیون', 'میلیارد',
  ])
  /** Units of measure: a number with one is the record's spec (128GB, 5 mm, 1.5千克) and does not change. */
  const MEASUREMENT_UNIT_SUFFIXES = new Set([
    'KB', 'kB', 'MB', 'GB', 'TB', 'PB', 'KiB', 'MiB', 'GiB', 'TiB', 'Kb', 'Mb', 'Gb', 'bit', 'bits',
    'kbps', 'Kbps', 'Mbps', 'Gbps',
    'nm', 'um', 'µm', 'μm', 'mm', 'cm', 'dm', 'km', 'in', 'inch', 'inches', 'ft', 'yd', 'mi',
    'mg', 'kg', 'lb', 'lbs', 'oz', 'ct', 'ml', 'mL', 'cl', 'dl', 'gal',
    'kW', 'MW', 'Wh', 'kWh', 'mV', 'kV', 'mA', 'mAh', 'Ah', 'Hz', 'kHz', 'MHz', 'GHz',
    'cal', 'kcal', 'kJ', 'Pa', 'kPa', 'MPa', 'psi', 'bar', 'rpm', 'dB',
    'px', 'dpi', 'ppi', 'MP', 'fps',
    'pcs', 'pc',
    '毫米', '厘米', '米', '千米', '公里', '寸', '英寸', '平米', '平方米', '立方米',
    '毫克', '克', '千克', '公斤', '斤', '吨', '毫升', '升',
    '瓦', '千瓦', '伏', '毫安', '毫安时', '赫兹', '像素', '万像素', '匹', '码',
    'センチ', 'ミリ', 'キロ', 'グラム',
  ])
  /** Currencies: a price changes, so a number with one is live. Codes that are also common words are left out. */
  const CURRENCY_CODES = new Set([
    'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'RMB', 'HKD', 'TWD', 'KRW', 'INR', 'IDR', 'MYR', 'SGD', 'THB',
    'VND', 'AUD', 'NZD', 'CAD', 'CHF', 'SEK', 'NOK', 'DKK', 'ISK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN',
    'RSD', 'HRK', 'UAH', 'RUB', 'BYN', 'KZT', 'UZS', 'AZN', 'ILS', 'AED', 'SAR', 'QAR', 'KWD', 'BHD',
    'OMR', 'JOD', 'EGP', 'TND', 'DZD', 'LBP', 'IQD', 'IRR', 'PKR', 'BDT', 'LKR', 'NPR', 'ZAR', 'NGN',
    'KES', 'GHS', 'TZS', 'UGX', 'ETB', 'XOF', 'XAF', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'UYU', 'PYG',
    'VES', 'CRC', 'GTQ', 'DOP', 'JMD', 'TTD', 'BTC', 'ETH', 'USDT', 'USDC',
  ])
  const CURRENCY_WORDS = new Set([
    'Rs', 'rs', 'Rp', 'RM', 'Kr', 'kr', 'kn', 'zł', 'Kč', 'Ft', 'lei', 'Lei', 'LEI', 'TL', 'Tk', 'Ksh',
    'KSh', 'Dhs', 'DH', 'Dh', 'din', 'Din', 'лв', 'руб', 'р', 'грн', 'сум', 'тенге', 'сом',
    'yuan', 'Yuan', 'euro', 'euros', 'Euro', 'Euros', 'dollar', 'dollars', 'yen', 'rupee', 'rupees',
    'ringgit', 'baht', 'peso', 'pesos', 'reais', 'lira', 'zloty', 'złotych', 'rubles', 'roubles',
    'рублей', 'рубля', 'рубль', 'гривень', 'гривні', 'гривня',
    '元', '块', '圆', '圓', '円', '원', 'บาท', 'đ', 'Đ', 'रु', 'रुपये',
    'رس', 'ريال', 'رق', 'رع', 'دإ', 'دا', 'دأ', 'درهم', 'دك', 'دب', 'دينار', 'جم', 'جنيه', 'لل', 'لس',
    'دم', 'دت', 'دج', 'تومان', 'ریال',
  ])
  const CURRENCY_ABBREVIATION_DECORATION = /[.\s]/gu
  /**
   * Count words after the number: what others add up over time (views, likes, comments, sold…). Compared
   * whole, first word after the number (lower case, edge punctuation off); two-word phrases by the first
   * two. Other words (rooms, Zimmer, seats, pages) are the record's attributes: two records that differ
   * only in one stay two rows. Words not listed count as attributes (the safe side).
   */
  const COUNT_WORDS = new Set([
    // en
    'views', 'view', 'plays', 'play', 'listens', 'listeners', 'streams', 'reads', 'likes', 'like',
    'dislikes', 'upvotes', 'upvote', 'downvotes', 'votes', 'vote', 'points', 'point', 'pts', 'karma',
    'comments', 'comment', 'replies', 'reply', 'answers', 'answer', 'reviews', 'review', 'ratings',
    'rating', 'shares', 'share', 'reposts', 'repost', 'retweets', 'retweet', 'quotes', 'saves', 'save',
    'bookmarks', 'bookmark', 'favorites', 'favorite', 'favourites', 'favourite', 'faves', 'fave',
    'stars', 'star', 'forks', 'fork', 'watchers', 'watcher', 'watching', 'followers', 'follower',
    'subscribers', 'subscriber', 'subs', 'fans', 'members', 'downloads', 'download', 'installs',
    'clicks', 'visits', 'visitors', 'hits', 'impressions', 'reactions', 'reaction', 'claps', 'kudos',
    'hearts', 'sold', 'sales', 'orders', 'purchases', 'purchased', 'bought', 'bids', 'bid', 'backers',
    'supporters', 'donors', 'donations', 'signatures', 'signers', 'applicants', 'enrolled', 'students',
    'learners', 'attendees', 'going', 'interested', 'posts', 'threads', 'topics', 'messages',
    'mentions', 'left', 'remaining', 'available',
    // de
    'aufrufe', 'aufruf', 'ansichten', 'wiedergaben', 'klicks', 'gefällt', 'kommentare', 'kommentar',
    'antworten', 'antwort', 'bewertungen', 'bewertung', 'rezensionen', 'rezension', 'stimmen',
    'stimme', 'punkte', 'punkt', 'abonnenten', 'verkauft', 'verkäufe', 'gebote', 'gebot',
    'beobachter', 'mitglieder', 'beiträge', 'beitrag', 'reaktionen', 'favoriten', 'sterne', 'mal',
    'verfügbar', 'übrig',
    // fr
    'vues', 'vue', 'visionnages', 'lectures', 'écoutes', "j'aime", 'j’aime', 'commentaires',
    'commentaire', 'réponses', 'réponse', 'avis', 'évaluations', 'partages', 'abonnés', 'abonné',
    'téléchargements', 'vendus', 'vendu', 'ventes', 'enchères', 'favoris', 'membres', 'sujets',
    'réactions', 'étoiles', 'disponibles', 'restants', 'fois',
    // es / pt / it
    'vistas', 'visualizaciones', 'reproducciones', 'comentarios', 'comentario', 'respuestas',
    'respuesta', 'reseñas', 'reseña', 'opiniones', 'valoraciones', 'calificaciones', 'votos', 'voto',
    'puntos', 'seguidores', 'suscriptores', 'descargas', 'vendidos', 'vendido', 'vendidas', 'ventas',
    'pujas', 'compartidos', 'favoritos', 'miembros', 'mensajes', 'estrellas', 'visitas', 'veces',
    'visualizações', 'curtidas', 'comentários', 'comentário', 'respostas', 'resposta', 'avaliações',
    'avaliação', 'pontos', 'inscritos', 'vendas', 'lances', 'compartilhamentos', 'membros',
    'estrelas', 'disponíveis', 'vezes', 'visualizzazioni', 'commenti', 'commento', 'risposte',
    'risposta', 'recensioni', 'recensione', 'voti', 'punti', 'iscritti', 'venduti', 'venduto',
    'vendite', 'condivisioni', 'preferiti', 'membri', 'stelle', 'disponibili', 'volte',
    // nl / nordic
    'weergaven', 'keer', 'reacties', 'reactie', 'beoordelingen', 'stemmen', 'punten', 'volgers',
    'abonnees', 'verkocht', 'biedingen', 'sterren', 'beschikbaar', 'visningar', 'gillar',
    'kommentarer', 'recensioner', 'röster', 'poäng', 'följare', 'sålda', 'visninger', 'anmeldelser',
    'følgere', 'solgt',
    // pl / cs
    'wyświetleń', 'wyświetlenia', 'polubień', 'polubienia', 'komentarzy', 'komentarze', 'komentarz',
    'odpowiedzi', 'opinii', 'opinie', 'ocen', 'oceny', 'głosów', 'głosy', 'punktów', 'punkty',
    'obserwujących', 'subskrybentów', 'pobrań', 'sprzedanych', 'sprzedano', 'razy', 'zhlédnutí',
    'komentářů', 'komentáře', 'hodnocení', 'recenzí', 'hlasů', 'bodů', 'sledujících', 'prodáno',
    // ru / uk
    'просмотров', 'просмотра', 'просмотр', 'просмотры', 'лайков', 'лайка', 'лайк', 'комментариев',
    'комментария', 'комментарий', 'комментарии', 'ответов', 'ответа', 'ответ', 'отзывов', 'отзыва',
    'отзыв', 'отзывы', 'оценок', 'оценки', 'оценка', 'голосов', 'голоса', 'голос', 'баллов', 'балла',
    'балл', 'очков', 'подписчиков', 'подписчика', 'подписчик', 'скачиваний', 'загрузок', 'продано',
    'продаж', 'покупок', 'заказов', 'заказа', 'заказ', 'ставок', 'ставки', 'репостов', 'участников',
    'раз', 'переглядів', 'перегляди', 'перегляд', 'вподобань', 'коментарів', 'коментарі', 'коментар',
    'відгуків', 'відгуки', 'відгук', 'голосів', 'підписників', 'замовлень',
    // tr / id / ms / vi
    'görüntüleme', 'izlenme', 'beğeni', 'yorum', 'yanıt', 'cevap', 'değerlendirme', 'oy', 'puan',
    'takipçi', 'abone', 'indirme', 'satıldı', 'satış', 'kez', 'dilihat', 'tayangan', 'suka',
    'komentar', 'balasan', 'ulasan', 'penilaian', 'poin', 'pengikut', 'unduhan', 'terjual', 'kali',
    'tersedia', 'lượt',
    // ar / fa / hi
    'مشاهدة', 'مشاهدات', 'إعجاب', 'إعجابات', 'تعليق', 'تعليقات', 'ردود', 'تقييم', 'تقييمات',
    'مراجعة', 'مراجعات', 'أصوات', 'نقطة', 'نقاط', 'متابع', 'متابعين', 'مشترك', 'مشتركين', 'تنزيل',
    'تحميل', 'مبيعات', 'بازدید', 'لایک', 'نظر', 'دیدگاه', 'پاسخ', 'امتیاز', 'رای', 'فروش', 'बार',
    'व्यू', 'लाइक', 'टिप्पणियाँ', 'टिप्पणी', 'समीक्षाएं', 'रेटिंग', 'वोट',
    // two-word phrases
    'in stock', 'me gusta', 'mi piace', 'bình luận', 'đánh giá', 'đã bán', 'theo dõi', 'người theo',
  ])
  /** Count words in text written without spaces (CJK, Thai): the number (one classifier, one particle) starts with one. */
  const UNSPACED_COUNT_WORD_PREFIXES = [
    // zh
    '播放', '观看', '觀看', '浏览', '瀏覽', '阅读', '閱讀', '点赞', '點讚', '點贊', '赞', '讚', '贊',
    '喜欢', '喜歡', '评论', '評論', '评价', '評價', '回复', '回覆', '回答', '收藏', '转发', '轉發',
    '分享', '关注', '關注', '粉丝', '粉絲', '订阅', '訂閱', '下载', '下載', '付款', '购买', '購買',
    '已购', '已購', '已售', '售出', '已卖', '销量', '銷量', '成交', '想要', '看过', '看過', '在看',
    '投票', '票', '弹幕', '彈幕', '投币', '投幣', '热度', '熱度', '人气', '人氣', '围观', '圍觀',
    '参与', '參與', '报名', '報名', '点击', '點擊', '访问', '訪問', '手', '股',
    // ja
    '再生', '視聴', '閲覧', 'いいね', 'コメント', 'レビュー', '評価', '回答', '返信', 'お気に入り',
    'ブックマーク', 'フォロワー', '登録者', 'ダウンロード', '販売', '購入', 'ビュー',
    // ko
    '조회', '좋아요', '댓글', '리뷰', '평가', '답변', '추천', '구독자', '팔로워', '다운로드', '판매',
    '구매',
    // th
    'วิว', 'ครั้ง', 'ถูกใจ', 'ความคิดเห็น', 'รีวิว', 'คะแนน', 'ผู้ติดตาม', 'ขายแล้ว',
  ]
  /** A classifier between the number and the count word (条评论, 次播放, 件のコメント, 개의 댓글). */
  const UNSPACED_COUNT_CLASSIFIER = /^[条條个個次人位篇件则則回名枚개명건번회위](?:[の의])?/u
  /** Classifiers that mean "times" or "place" on their own: 1234次, 12回, 1,234회, 1位, 1위. */
  const STANDALONE_COUNT_CLASSIFIERS = new Set(['次', '回', '회', '位', '위'])
  /** Rank suffixes (1st, 2nd, 1er, 3ème, 1º): a ranking reorders. */
  const RANK_SUFFIXES = new Set(['st', 'nd', 'rd', 'th', 'er', 're', 'e', 'ème', 'eme', 'º', 'ª'])
  /** "… ago": elapsed time (4d ago, 3 ore fa, 2 дня назад, 3小时前, 3시간 전) moves on. */
  const ELAPSED_TIME_AGO_WORDS = new Set([
    'ago', 'назад', 'тому', 'geleden', 'sedan', 'siden', 'temu', 'lalu', 'trước', 'önce', 'fa',
    'atrás', 'پیش', 'पहले', '전',
  ])
  const UNSPACED_ELAPSED_TIME_AGO = /^(?:秒钟?|秒鐘|分钟|分鐘|分間?|小时|小時|个小时|個小時|時間|天|日|周|週|星期|个月|個月|ヶ月|か月|カ月|月|年|초|분|시간|일|주|개월|달|년)\s?(?:前|전)/u
  const SUFFIX_LEADING_DECORATION = /^[\s.,'’)）]+/u
  const WORD_EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu
  const WHITESPACE_RUN = /\s+/u

  function findLastDigitIndex(value) {
    const characters = Array.from(value)
    let codeUnitIndex = value.length
    for (let index = characters.length - 1; index >= 0; index -= 1) {
      const character = characters[index] ?? ''
      codeUnitIndex -= character.length
      if (DIGIT.test(character)) return codeUnitIndex
    }
    return -1
  }

  /** Bare digits (or digits in space-separated groups) read as an identifier, not a quantity. */
  function isIdentifierDigits(value) {
    if (SPACE_SEPARATED_DIGIT_GROUPS.test(value)) return !SPACE_THOUSANDS_GROUPING.test(value)
    if (!BARE_DIGITS.test(value)) return false
    const digitCount = Array.from(value).length
    return digitCount >= IDENTIFIER_MIN_BARE_DIGITS || (digitCount >= LEADING_ZERO_IDENTIFIER_MIN_DIGITS && LEADING_ZERO.test(value))
  }

  const countCharacters = value => Array.from(value).length

  /** Thousands grouping (one separator throughout): western 1–3 then 3s, or Indian 1–2, 2s, then 3. */
  function isThousandsGrouping(groups, separators) {
    const [separator] = separators
    if (separator === undefined) return true
    if (separator === DECIMAL_ONLY_SEPARATOR || separators.some(other => other !== separator)) return false
    const [firstLength = 0, ...restLengths] = groups.map(countCharacters)
    const isWesternGrouping = firstLength <= 3 && restLengths.every(length => length === 3)
    const lastLength = restLengths[restLengths.length - 1]
    const isIndianGrouping =
      separator === ',' &&
      restLengths.length >= 2 &&
      firstLength <= 2 &&
      restLengths.slice(0, -1).every(length => length === 2) &&
      lastLength === 3
    return isWesternGrouping || isIndianGrouping
  }

  function normalizeDigitSeparator(separator) {
    if (separator === '，') return ','
    if (separator === '．') return '.'
    return WHITESPACE_RUN.test(separator) ? ' ' : separator
  }

  /**
   * Whether a run of digits is a number in some notation: thousands groups, then maybe a decimal part.
   * Dotted dates (12.03.2024), phone numbers, version numbers and IP addresses are not.
   */
  function isWellFormedDigitRun(run) {
    const groups = run.split(DIGIT_RUN_SEPARATOR)
    const separators = (run.match(DIGIT_RUN_SEPARATOR) ?? []).map(normalizeDigitSeparator)
    const lastSeparator = separators[separators.length - 1]
    if (lastSeparator === undefined) return true
    const integerSeparators = separators.slice(0, -1)
    const canEndWithDecimalPart =
      !THOUSANDS_ONLY_SEPARATOR.test(lastSeparator) &&
      !integerSeparators.includes(lastSeparator) &&
      isThousandsGrouping(groups.slice(0, -1), integerSeparators)
    return canEndWithDecimalPart || isThousandsGrouping(groups, separators)
  }

  const hasOnlyWellFormedDigitRuns = numberBody => (numberBody.match(DIGIT_RUN) ?? []).every(isWellFormedDigitRun)

  function isCurrencyWord(word) {
    const normalizedWord = word.replace(CURRENCY_ABBREVIATION_DECORATION, '')
    return CURRENCY_CODES.has(normalizedWord) || CURRENCY_WORDS.has(normalizedWord)
  }

  /** Drop a currency prefix: HK$ / US$ (letters + symbol), or a code / abbreviation (USD, Rs., RM). */
  function stripCurrencyPrefix(numberBody) {
    const withoutSymbolPrefix = numberBody.replace(CURRENCY_LETTER_PREFIX, '')
    if (withoutSymbolPrefix !== numberBody) return withoutSymbolPrefix
    const leadingWord = LEADING_WORD.exec(numberBody)
    return leadingWord && isCurrencyWord(leadingWord[1] ?? '') ? numberBody.slice(leadingWord[0].length) : numberBody
  }

  const splitSuffixWords = suffix =>
    suffix
      .toLowerCase()
      .split(WHITESPACE_RUN)
      .map(word => word.replace(WORD_EDGE_PUNCTUATION, ''))
      .filter(word => word.length > 0)

  function startsWithUnspacedCountWord(firstWord, nextWord) {
    const classifier = UNSPACED_COUNT_CLASSIFIER.exec(firstWord)?.[0] ?? ''
    const afterClassifier = firstWord.slice(classifier.length)
    const startsWithCountWord = word => UNSPACED_COUNT_WORD_PREFIXES.some(countWord => word.startsWith(countWord))
    if (classifier.length > 0 && afterClassifier.length === 0) {
      return STANDALONE_COUNT_CLASSIFIERS.has(classifier) || (nextWord !== undefined && startsWithCountWord(nextWord))
    }
    return startsWithCountWord(afterClassifier) || startsWithCountWord(firstWord)
  }

  /** Whether the words after the number name a quantity that changes: currency, count, rank, "… ago". */
  function namesLiveQuantity(suffixStart, unitWord) {
    if (isCurrencyWord(unitWord) || RANK_SUFFIXES.has(unitWord.toLowerCase())) return true
    const words = splitSuffixWords(suffixStart)
    const [firstWord, secondWord] = words
    if (firstWord === undefined) return false
    if (
      COUNT_WORDS.has(firstWord) ||
      MAGNITUDE_WORDS.has(firstWord) ||
      (secondWord !== undefined && COUNT_WORDS.has(`${firstWord} ${secondWord}`)) ||
      words.some(word => ELAPSED_TIME_AGO_WORDS.has(word))
    ) {
      return true
    }
    return startsWithUnspacedCountWord(firstWord, secondWord) || UNSPACED_ELAPSED_TIME_AGO.test(suffixStart)
  }

  function isLiveNumberSuffix(rawSuffix) {
    const unitWord = rawSuffix.replace(NUMERIC_DECORATION, '')
    if (unitWord.length === 0) return true
    if (MEASUREMENT_UNIT_SUFFIXES.has(unitWord)) return false
    const suffixStart = rawSuffix.replace(SUFFIX_LEADING_DECORATION, '')
    if (LATIN_MAGNITUDE_SUFFIX.test(suffixStart) || UNSPACED_MAGNITUDE_SUFFIX.test(suffixStart)) return true
    return namesLiveQuantity(suffixStart, unitWord)
  }

  /**
   * A value that changes while the record stays the same: a number (signs, grouping, %, brackets, colon,
   * currency allowed) followed by nothing, a magnitude, a currency, a count word, a rank or "… ago" —
   * "43.49万手", "-0.05 (-0.85%)", "$1.32T", "2:31", "102", "1.2K views", "3.4万次播放", "2,801円", "4d ago".
   * Not: letters before or between digits ("iPhone 15"), digit-dash-digit (dates, ranges), identifiers
   * (5+ bare digits, leading zero, phone-like groups, dotted dates), numbers with a unit or an attribute
   * word ("128GB", "3 Zimmer", "2 间卧室", "9 Mar").
   */
  function isLiveNumber(value) {
    const trimmedValue = String(value).trim()
    if (!DIGIT.test(trimmedValue) || DIGIT_DASH_DIGIT.test(trimmedValue)) return false
    if (isIdentifierDigits(trimmedValue)) return false
    const lastDigitIndex = findLastDigitIndex(trimmedValue)
    const numberBody = stripCurrencyPrefix(trimmedValue.slice(0, lastDigitIndex + 1))
    const bodyLeftover = numberBody.replace(DIGITS, '').replace(NUMERIC_DECORATION, '')
    return bodyLeftover.length === 0 && hasOnlyWellFormedDigitRuns(numberBody) && isLiveNumberSuffix(trimmedValue.slice(lastDigitIndex + 1))
  }

  /** A picture, video or sound file: lazy-loaded, swapped for another size or a placeholder while the record stays. */
  const MEDIA_FILE = /\.(?:jpe?g|jfif|png|gif|webp|avif|bmp|svg|ico|heic|heif|tiff?|mp4|m4v|webm|mov|m3u8|mp3|m4a|ogg|wav)(?:$|[?#@!_,~])/i
  function isMediaUrl(value) {
    const text = String(value).trim()
    if (/^data:(?:image|video|audio)\//i.test(text) || /^blob:/i.test(text)) return true
    if (!/^(?:https?:)?\/\//i.test(text)) return false
    return MEDIA_FILE.test(text.replace(/^(?:https?:)?\/\/[^/]*/i, ''))
  }

  return { isLiveNumber, isMediaUrl }
}
