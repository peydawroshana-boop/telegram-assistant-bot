export default {
  async fetch(request, env, ctx) {
    // اطمینان از اینکه درخواست از نوع POST است (Webhook تلگرام)
    if (request.method !== "POST") {
      return new Response("Only POST requests are accepted", { status: 405 });
    }

    try {
      const update = await request.json();
      
      // اگر پیام متنی بود
      if (update.message && update.message.text) {
        const chatId = update.message.chat.id;
        const userText = update.message.text;

        // ۱. ارسال پیام به هوش مصنوعی برای تحلیل JSON
        const aiResponse = await fetch(env.AI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.AI_API_KEY}`
          },
          body: JSON.stringify({
            messages: [
              { role: "system", content: env.SYSTEM_PROMPT },
              { role: "user", content: userText }
            ]
          })
        });

        const aiData = await aiResponse.json();
        const aiTextResult = aiData.choices[0].message.content;

        // ۲. استخراج JSON از پاسخ هوش مصنوعی
        let parsedData;
        try {
          parsedData = JSON.parse(aiTextResult);
        } catch (e) {
          // در صورت بروز خطا در فرمت JSON
          await sendTelegramMessage(env.TELEGRAM_TOKEN, chatId, "خطا در درک پیام. لطفاً دوباره تلاش کن.");
          return new Response("OK");
        }

        // ۳. ذخیره در KV بر اساس ستون مربوطه
        if (parsedData.action !== "general_chat" && parsedData.column) {
          const userKey = `user_${chatId}_col_${parsedData.column}`;
          let columnData = await env.BOT_KV.get(userKey, { type: "json" }) || [];
          
          columnData.push(parsedData.data);
          await env.BOT_KV.put(userKey, JSON.stringify(columnData));
        }

        // ۴. ارسال پیام تایید به کاربر
        await sendTelegramMessage(env.TELEGRAM_TOKEN, chatId, parsedData.reply_to_user);
      }

      return new Response("OK");
    } catch (error) {
      console.error(error);
      return new Response("Error", { status: 500 });
    }
  },

  // بخش مربوط به زمان‌بندی (Cron Triggers)
  async scheduled(event, env, ctx) {
    // نکته: برای ارسال پیام خودکار، باید Chat ID کاربران را داشته باشیم.
    // در یک سیستم تک‌کاربره، این ID در Environment Variables تنظیم می‌شود.
    const myChatId = env.ADMIN_CHAT_ID;

    // بررسی نوع زمان‌بندی بر اساس Cron String تنظیم شده در داشبورد
    switch (event.cron) {
      // گزارش صبحگاهی (مثلاً ساعت 7:00 صبح به وقت محلی)
      case "30 3 * * *": // بر اساس UTC تنظیم می‌شود
        let col2Data = await env.BOT_KV.get(`user_${myChatId}_col_2`, { type: "json" }) || [];
        let todayTasks = col2Data.map(t => `- ${t.title}`).join('\n');
        
        let morningMsg = ` صبح بخیر!\n\nلیست کارهای امروز (ستون ۲):\n${todayTasks || "امروز تسکی ثبت نشده است."}\n\nپر انرژی شروع کن!`;
        await sendTelegramMessage(env.TELEGRAM_TOKEN, myChatId, morningMsg);
        break;

      // یادآوری Pivot & polish (مثلاً ساعت 21:00)
      case "30 17 * * *": // بر اساس UTC
        let pivotMsg = `🕰 وقت **Pivot & polish** است!\n\nلطفاً کارهای امروزت را مرور کن، گزارش‌های ستون ۱ (عادت‌ها و کسر پیشرفت‌ها) را بررسی کن و نتایج بازتاب امروزت را برای انتشار در پنهان آماده کن.`;
        await sendTelegramMessage(env.TELEGRAM_TOKEN, myChatId, pivotMsg);
        break;
    }
  }
};

// تابع کمکی برای ارسال پیام به تلگرام
async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown"
    })
  });
}
