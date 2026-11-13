require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

if (!BOT_TOKEN || BOT_TOKEN === 'SIZNING_BOT_TOKENINGIZ') {
    console.error("XATOLIK: .env faylida BOT_TOKEN ko'rsatilmagan! Iltimos, BotFather bergan tokenni .env fayliga kiriting.");
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Xatoliklarni ushlab qolish (bot to'xtab qolmasligi uchun)
bot.catch((err, ctx) => {
    console.error(`Xatolik yuz berdi (${ctx.updateType}):`, err);
});

// Mijozlarning holatini (FSM) saqlash uchun xotira
const userStates = new Map();

// Bosqichlar:
// 1. WAITING_LOCATION
// 2. WAITING_CAR
// 3. WAITING_SERVICE_TYPE
// 4. WAITING_PROBLEM_DETAILS
// 5. WAITING_PHONE

// Bekor qilish tugmasi klaviaturasi
const cancelKeyboard = Markup.keyboard([
    ['❌ Bekor qilish']
]).resize();

// Boshlang'ich /start buyrug'i
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    // Holatni tozalaymiz
    userStates.set(userId, { step: 'WAITING_LOCATION', data: {} });

    const welcomeText = 
`👋 *Assalomu alaykum!*
Siz *O‘zbekistondagi №1 kalit yasovchi* ustaga murojaat qilyapsiz. 🔑🚗

Biz sizga tez va sifatli yordam bera olishimiz uchun, iltimos, pastdagi tugmani bosib hozirgi **turgan lokatsiyangizni yuboring**.`;

    await ctx.replyWithMarkdown(welcomeText, Markup.keyboard([
        [Markup.button.locationRequest('📍 Lokatsiyani yuborish')],
        ['❌ Bekor qilish']
    ]).resize());
});

// Bekor qilish
bot.hears('❌ Bekor qilish', async (ctx) => {
    userStates.delete(ctx.from.id);
    await ctx.reply(
        "Buyurtma bekor qilindi. Qaytadan boshlash uchun /start buyrug'ini bosing.",
        Markup.removeKeyboard()
    );
});

// 1. Lokatsiya qabul qilish
bot.on('location', async (ctx) => {
    const userId = ctx.from.id;
    const user = userStates.get(userId);

    if (!user || user.step !== 'WAITING_LOCATION') {
        return;
    }

    user.data.location = ctx.message.location;
    user.step = 'WAITING_CAR';

    // Admin ga mijoz lokatsiyasi haqida tezkor xabar (dastlabki bildirishnoma)
    if (ADMIN_ID && ADMIN_ID !== 'SIZNING_TELEGRAM_ID') {
        const userInfo = ctx.from.first_name + (ctx.from.username ? ` (@${ctx.from.username})` : '');
        bot.telegram.sendMessage(ADMIN_ID, `🔔 Yangi mijoz murojaat qildi: ${userInfo}\nMijoz lokatsiyasi yuborildi:`).catch(() => {});
        bot.telegram.sendLocation(ADMIN_ID, ctx.message.location.latitude, ctx.message.location.longitude).catch(() => {});
    }

    await ctx.reply(
        "📍 Lokatsiyangiz qabul qilindi!\n\nEndi aytingchi, **qanday mashina?**\n(Masalan: Chevrolet Gentra 2022, Cobalt, Malibu, Kia K5, BYD va h.k.)",
        cancelKeyboard
    );
});

// 2 & 3 & 4 & 5-bosqichlar: Matn va boshqa xabarlarni qayta ishlash
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const user = userStates.get(userId);

    if (!user) {
        return ctx.reply("Buyurtma berish uchun /start buyrug'ini bosing.");
    }

    // 2. Mashina rusumi qabul qilindi
    if (user.step === 'WAITING_CAR') {
        user.data.car = ctx.message.text;
        user.step = 'WAITING_SERVICE_TYPE';

        const serviceKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🔑 Yangi kalit yasash', 'srv_yangi_kalit')],
            [Markup.button.callback('🗝 Kalit nusxalash (dublikat)', 'srv_dublikat')],
            [Markup.button.callback('🚨 Yangi pult / dasturlash', 'srv_pult')],
            [Markup.button.callback('🚪 Qulflanib qolgan eshikni ochish', 'srv_ochish')],
            [Markup.button.callback('⚙️ Boshqa muammo', 'srv_boshqa')]
        ]);

        return ctx.reply(
            `🚗 Mashina: *${user.data.car}*\n\nSizga aynan qanday xizmat, kalit yoki pult kerak? Quyidagilardan tanlang:`,
            { parse_mode: 'Markdown', ...serviceKeyboard }
        );
    }

    // 4. Muammo tavsifi qabul qilindi
    if (user.step === 'WAITING_PROBLEM_DETAILS') {
        user.data.problemDetails = ctx.message.text;
        user.step = 'WAITING_PHONE';

        const phoneKeyboard = Markup.keyboard([
            [Markup.button.contactRequest('📱 Telefon raqamimni yuborish')],
            ['❌ Bekor qilish']
        ]).resize();

        return ctx.reply(
            "Iltimos, siz bilan tezda bog'lanishimiz uchun **telefon raqamingizni** yuboring yoki yozib qoldiring:",
            phoneKeyboard
        );
    }

    // 5. Telefon raqami qo'lda yozilganda
    if (user.step === 'WAITING_PHONE') {
        user.data.phone = ctx.message.text;
        await finishOrder(ctx, user);
    }
});

// Inline tugmalar bosilganda (Xizmat turini tanlash)
bot.action(/srv_(.+)/, async (ctx) => {
    const userId = ctx.from.id;
    const user = userStates.get(userId);

    if (!user || user.step !== 'WAITING_SERVICE_TYPE') {
        return ctx.answerCbQuery("Eski so'rov. Iltimos qaytadan /start bosing.");
    }

    const type = ctx.match[1];
    const serviceNames = {
        'yangi_kalit': '🔑 Yangi kalit yasash',
        'dublikat': '🗝 Kalit nusxalash (dublikat)',
        'pult': '🚨 Yangi pult / dasturlash',
        'ochish': '🚪 Qulflanib qolgan eshikni ochish',
        'boshqa': '⚙️ Boshqa muammo'
    };

    user.data.serviceType = serviceNames[type] || 'Boshqa';
    user.step = 'WAITING_PROBLEM_DETAILS';

    await ctx.answerCbQuery();
    await ctx.reply(
        `Tanlandi: *${user.data.serviceType}*\n\nEndi qanday muammo bo'layotganini batafsilroq yozib bering:\n(Masalan: Kalit butunlay yo'qolganmi, pult ishlamay qoldimi, chipi kuyganmi yoki ichida qolib ketdimi?)\n\n*Xohlasangiz rasm yoki ovozli xabar ham tashlashingiz mumkin.*`,
        { parse_mode: 'Markdown', ...cancelKeyboard }
    );
});

// Rasm yoki ovozli xabar qabul qilish (Muammo tavsifi sifatida)
bot.on(['photo', 'voice', 'video'], async (ctx) => {
    const userId = ctx.from.id;
    const user = userStates.get(userId);

    if (user && user.step === 'WAITING_PROBLEM_DETAILS') {
        user.data.mediaMessageId = ctx.message.message_id;
        user.data.problemDetails = ctx.message.caption || "(Mijoz rasm/ovozli xabar yubordi)";
        user.step = 'WAITING_PHONE';

        const phoneKeyboard = Markup.keyboard([
            [Markup.button.contactRequest('📱 Telefon raqamimni yuborish')],
            ['❌ Bekor qilish']
        ]).resize();

        return ctx.reply(
            "Fayl qabul qilindi! Endi usta siz bilan bog'lanishi uchun **telefon raqamingizni** yuboring:",
            phoneKeyboard
        );
    }
});

// Kontakt (telefon raqam) tugmasi bosilganda
bot.on('contact', async (ctx) => {
    const userId = ctx.from.id;
    const user = userStates.get(userId);

    if (!user || user.step !== 'WAITING_PHONE') {
        return;
    }

    user.data.phone = ctx.message.contact.phone_number;
    await finishOrder(ctx, user);
});

// Buyurtmani yakunlash va adminga yuborish funksiyasi
async function finishOrder(ctx, user) {
    const userId = ctx.from.id;
    const from = ctx.from;
    const data = user.data;

    // Mijozga rahmat xabari
    await ctx.reply(
        `✅ *Katta rahmat! Buyurtmangiz qabul qilindi.*\n\nO‘zbekistondagi №1 kalit ustasi arizangizni ko‘rib chiqib, tez orada siz bilan bog'lanadi yoki ko'rsatilgan manzilga yetib boradi! 🚗💨`,
        { parse_mode: 'Markdown', ...Markup.removeKeyboard() }
    );

    // Bot egasiga (Admin/Usta) to'liq arizani yuborish
    if (ADMIN_ID && ADMIN_ID !== 'SIZNING_TELEGRAM_ID') {
        const username = from.username ? `@${from.username}` : "Mavjud emas";
        const fullName = `${from.first_name || ''} ${from.last_name || ''}`.trim();

        const adminMessage = 
`🔔 *YANGI MUROJAAT / BUYURTMA!* 🔔
━━━━━━━━━━━━━━━━━━━━━
👤 *Mijoz:* ${fullName}
📱 *Username:* ${username}
🆔 *Telegram ID:* \`${userId}\`
📞 *Telefon:* \`${data.phone || 'Kiritilmagan'}\`
━━━━━━━━━━━━━━━━━━━━━
🚗 *Avtomobil:* ${data.car || 'Noma\'lum'}
🛠 *Xizmat turi:* ${data.serviceType || 'Noma\'lum'}
📝 *Muammo tavsifi:*
${data.problemDetails || 'Tavsif berilmagan'}
━━━━━━━━━━━━━━━━━━━━━
📍 *Mijoz lokatsiyasi quyida yuborildi:*`;

        try {
            // 1. Matnli arizani yuborish
            await bot.telegram.sendMessage(ADMIN_ID, adminMessage, { parse_mode: 'Markdown' });

            // 2. Lokatsiyani yuborish (usta xaritada ko'rib, navigator ochishi mumkin)
            if (data.location) {
                await bot.telegram.sendLocation(
                    ADMIN_ID,
                    data.location.latitude,
                    data.location.longitude
                );
            }

            // 3. Agar mijoz rasm/audio tashlagan bo'lsa, uni ham adminga forward qilish
            if (data.mediaMessageId) {
                await bot.telegram.forwardMessage(ADMIN_ID, userId, data.mediaMessageId);
            }
        } catch (err) {
            console.error("Adminga xabar yuborishda xatolik:", err.message);
        }
    } else {
        console.warn("DIQQAT: ADMIN_ID sozlanmagan. Arizalar adminga yetib bormaydi.");
    }

    // Foydalanuvchi holatini tozalash
    userStates.delete(userId);
}

// Botni ishga tushirish
bot.launch().then(() => {
    console.log("==========================================");
    console.log("🚀 Kalit yasovchi bot muvaffaqiyatli ishga tushdi!");
    console.log("==========================================");
}).catch((err) => {
    console.error("Botni ishga tushirishda xatolik:", err);
});

// Xavfsiz to'xtatish (graceful stop)
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
