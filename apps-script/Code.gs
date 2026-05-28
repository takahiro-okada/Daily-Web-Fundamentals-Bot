const SHEET_TOPICS = 'Topics';
const SHEET_LOGS = 'Logs';

function sendDailyWebTopic() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const topicsSheet = ss.getSheetByName(SHEET_TOPICS);
  const logsSheet = ss.getSheetByName(SHEET_LOGS);

  const topics = topicsSheet.getDataRange().getValues();
  const headers = topics[0];

  const topicCol = headers.indexOf('topic');
  const categoryCol = headers.indexOf('category');
  const levelCol = headers.indexOf('level');
  const sentCol = headers.indexOf('sent');

  const targetRowIndex = topics.findIndex(function(row, index) {
    if (index === 0) return false;
    return row[sentCol] === false || row[sentCol] === 'FALSE' || row[sentCol] === '';
  });

  if (targetRowIndex === -1) {
    throw new Error('No unsent topics found.');
  }

  const row = topics[targetRowIndex];
  const topic = row[topicCol];
  const category = row[categoryCol];
  const level = row[levelCol];

  const content = generateWithGemini(topic, category, level);
  const html = convertMarkdownToHtml(content);

  const recipient = Session.getActiveUser().getEmail();

  GmailApp.sendEmail(
    recipient,
    '【Daily Web Fundamentals】' + topic,
    stripMarkdown(content),
    { htmlBody: html }
  );

  const notionPageUrl = createNotionPage({
    topic: topic,
    category: category,
    level: level,
    summary: extractSection(content, '一言でいうと'),
    quiz: extractSection(content, '今日のクイズ')
  });

  logsSheet.appendRow([
    new Date(),
    topic,
    category,
    content.slice(0, 1000),
    notionPageUrl
  ]);

  topicsSheet.getRange(targetRowIndex + 1, sentCol + 1).setValue(true);
}

function generateWithGemini(topic, category, level) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

  const prompt =
    'あなたはWebエンジニア向けニュースレター編集者です。\n\n' +
    '以下のTopicについて、「毎朝5分で読める学習メール」を日本語で作成してください。\n\n' +
    'Topic: ' + topic + '\n' +
    'Category: ' + category + '\n' +
    'Level: ' + level + '\n\n' +
    '条件:\n' +
    '- AIっぽい前置き禁止\n' +
    '- シンプルで読みやすい\n' +
    '- 箇条書き中心\n' +
    '- 実務寄り\n' +
    '- スマホで読みやすい\n' +
    '- 500〜900文字程度\n' +
    '- Markdownの太字記法（**text**）は使わない\n' +
    '- 箇条書きは「- 」だけを使う\n' +
    '- クイズの答えは絶対に書かない\n\n' +
    '必ず以下の形式にする:\n\n' +
    '# 今日のTopic\n\n' +
    '## 一言でいうと\n\n' +
    '## なぜ重要？\n\n' +
    '## 実務でよくある例\n\n' +
    '## よくあるミス\n\n' +
    '## 今日のクイズ\n\n' +
    '## 英語キーワード\n';

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + apiKey;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ]
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const json = JSON.parse(response.getContentText());

  if (!json.candidates) {
    throw new Error(response.getContentText());
  }

  return json.candidates[0].content.parts[0].text;
}

function createNotionPage(data) {
  const notionToken = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  const databaseId = PropertiesService.getScriptProperties().getProperty('NOTION_DATABASE_ID');

  const payload = {
    parent: {
      database_id: databaseId
    },
    properties: {
      Topic: {
        title: [
          {
            text: {
              content: data.topic
            }
          }
        ]
      },
      Category: {
        select: {
          name: data.category
        }
      },
      Level: {
        select: {
          name: data.level
        }
      },
      Summary: {
        rich_text: [
          {
            text: {
              content: data.summary.slice(0, 1900)
            }
          }
        ]
      },
      Quiz: {
        rich_text: [
          {
            text: {
              content: data.quiz.slice(0, 1900)
            }
          }
        ]
      },
      Date: {
        date: {
          start: new Date().toISOString()
        }
      },
      Status: {
        select: {
          name: 'Not Reviewed'
        }
      }
    }
  };

  const response = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + notionToken,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const json = JSON.parse(response.getContentText());

  if (!json.url) {
    throw new Error(response.getContentText());
  }

  return json.url;
}

function extractSection(text, heading) {
  const pattern = new RegExp('## ' + heading + '\\n([\\s\\S]*?)(\\n## |$)');
  const match = text.match(pattern);
  return match ? match[1].trim() : '';
}

function stripMarkdown(text) {
  return text
    .replace(/#/g, '')
    .replace(/\*/g, '');
}

function convertMarkdownToHtml(markdown) {
  let html = markdown;

  html = html.replace(/^# (.*$)/gim, '<h1 style="font-size:24px;margin-top:24px;">$1</h1>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="font-size:18px;margin-top:20px;color:#2563eb;">$1</h2>');

  // 太字: **text**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // 箇条書き: * item / - item
  html = html.replace(/^\* (.*$)/gim, '<li>$1</li>');
  html = html.replace(/^- (.*$)/gim, '<li>$1</li>');

  // 連続した li を ul で囲む
  html = html.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');
  html = html.replace(/<\/li>\s*<li>/g, '</li><li>');

  html = html.replace(/\n/g, '<br>');

  return (
    '<div style="font-family: Arial, sans-serif; max-width: 700px; margin: auto; line-height: 1.8; font-size: 15px; color: #222;">' +
    html +
    '<hr style="margin-top:40px;margin-bottom:20px;">' +
    '<p style="color:#888;font-size:12px;">Daily Web Engineering Fundamentals</p>' +
    '</div>'
  );
}

function sendWeeklyReview() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logsSheet = ss.getSheetByName(SHEET_LOGS);

  const values = logsSheet.getDataRange().getValues();

  if (values.length <= 1) {
    throw new Error('No logs found.');
  }

  const headers = values[0];

  const dateCol = headers.indexOf('date');
  const topicCol = headers.indexOf('topic');
  const categoryCol = headers.indexOf('category');
  const summaryCol = headers.indexOf('summary');

  const now = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(now.getDate() - 7);

  const weeklyLogs = values.slice(1).filter(function(row) {
    const date = new Date(row[dateCol]);
    return date >= sevenDaysAgo && date <= now;
  });

  if (weeklyLogs.length === 0) {
    throw new Error('No weekly logs found.');
  }

  const weeklyText = weeklyLogs.map(function(row) {
    return (
      '- Topic: ' + row[topicCol] + '\n' +
      '  Category: ' + row[categoryCol] + '\n' +
      '  Summary: ' + row[summaryCol]
    );
  }).join('\n\n');

  const reviewContent = generateWeeklyReviewWithGemini(weeklyText);
  const html = convertMarkdownToHtml(reviewContent);

  const recipient = Session.getActiveUser().getEmail();

  GmailApp.sendEmail(
    recipient,
    '【Weekly Review】今週のWeb基礎復習',
    stripMarkdown(reviewContent),
    { htmlBody: html }
  );
}

function generateWeeklyReviewWithGemini(weeklyText) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

  const prompt =
    'あなたはWebエンジニア向けの学習コーチです。\n\n' +
    '以下は今週学習したWebエンジニア向け基礎トピックです。\n' +
    'これを元に、日曜の復習メールを日本語で作成してください。\n\n' +
    weeklyText + '\n\n' +
    '条件:\n' +
    '- AIっぽい前置き禁止\n' +
    '- 重要ポイントを整理する\n' +
    '- 今週の学び同士のつながりを説明する\n' +
    '- ミニテストを5問作る\n' +
    '- ミニテストの答えも最後にまとめる\n' +
    '- 1000〜1500文字程度\n\n' +
    '必ず以下の形式にする:\n\n' +
    '# Weekly Review\n\n' +
    '## 今週学んだTopic\n\n' +
    '## 重要ポイントまとめ\n\n' +
    '## Topic同士のつながり\n\n' +
    '## ミニテスト\n\n' +
    '## 解答\n\n' +
    '## 来週への一言\n';

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + apiKey;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ]
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const json = JSON.parse(response.getContentText());

  if (!json.candidates) {
    throw new Error(response.getContentText());
  }

  return json.candidates[0].content.parts[0].text;
}
