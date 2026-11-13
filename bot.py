import asyncio
import os
import logging
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    KeyboardButton,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
)

from aiohttp import web

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN") or "9119379055:AAFiksuuDoItIuqgEeKm_0l5m8RfnrHBGXI"
ADMIN_ID = os.getenv("ADMIN_ID") or "7599446475"

logging.basicConfig(level=logging.INFO)

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())

# FSM holatlari (bosqichlar)
class OrderState(StatesGroup):
    waiting_location = State()
    waiting_car = State()
    waiting_service_type = State()
    waiting_problem_details = State()
    waiting_phone = State()

# Bekor qilish klaviaturasi
cancel_kb = ReplyKeyboardMarkup(
    keyboard=[[KeyboardButton(text="❌ Bekor qilish")]],
    resize_keyboard=True
)

@dp.message(Command("cancel"))
@dp.message(F.text == "❌ Bekor qilish")
async def cancel_handler(message: types.Message, state: FSMContext):
    await state.clear()
    await message.answer(
        "Buyurtma bekor qilindi. Qaytadan boshlash uchun /start buyrug'ini bosing.",
        reply_markup=ReplyKeyboardRemove()
    )

# /start bosilganda
@dp.message(CommandStart())
async def start_handler(message: types.Message, state: FSMContext):
    await state.clear()
    await state.set_state(OrderState.waiting_location)

    text = (
        "👋 *Assalomu alaykum!*\n"
        "Siz *O‘zbekistondagi №1 kalit yasovchi* ustaga murojaat qilyapsiz. 🔑🚗\n\n"
        "Biz sizga tez va sifatli yordam bera olishimiz uchun, iltimos, pastdagi tugmani bosib hozirgi **turgan lokatsiyangizni yuboring**."
    )

    location_kb = ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="📍 Lokatsiyani yuborish", request_location=True)],
            [KeyboardButton(text="❌ Bekor qilish")]
        ],
        resize_keyboard=True
    )

    await message.answer(text, parse_mode="Markdown", reply_markup=location_kb)

# 1. Lokatsiya qabul qilish
@dp.message(OrderState.waiting_location, F.location)
async def location_received(message: types.Message, state: FSMContext):
    loc = message.location
    await state.update_data(latitude=loc.latitude, longitude=loc.longitude)
    await state.set_state(OrderState.waiting_car)

    # Adminga dastlabki xabar
    if ADMIN_ID and ADMIN_ID != "SIZNING_TELEGRAM_ID":
        try:
            user_info = f"{message.from_user.full_name} (@{message.from_user.username})"
            await bot.send_message(ADMIN_ID, f"🔔 Yangi mijoz kirdi: {user_info}\nMijoz lokatsiyasi:")
            await bot.send_location(ADMIN_ID, loc.latitude, loc.longitude)
        except Exception as e:
            logging.error(f"Dastlabki lokatsiyani yuborishda xatolik: {e}")

    await message.answer(
        "📍 Lokatsiyangiz qabul qilindi!\n\nEndi aytingchi, **qanday mashina?**\n(Masalan: Chevrolet Gentra 2022, Cobalt, Malibu, Kia K5, BYD va h.k.)",
        parse_mode="Markdown",
        reply_markup=cancel_kb
    )

# 2. Mashina rusumi qabul qilish
@dp.message(OrderState.waiting_car, F.text)
async def car_received(message: types.Message, state: FSMContext):
    await state.update_data(car=message.text)
    await state.set_state(OrderState.waiting_service_type)

    service_kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🔑 Yangi kalit yasash", callback_data="srv_yangi_kalit")],
            [InlineKeyboardButton(text="🗝 Kalit nusxalash (dublikat)", callback_data="srv_dublikat")],
            [InlineKeyboardButton(text="🚨 Yangi pult / dasturlash", callback_data="srv_pult")],
            [InlineKeyboardButton(text="🚪 Qulflanib qolgan eshikni ochish", callback_data="srv_ochish")],
            [InlineKeyboardButton(text="⚙️ Boshqa muammo", callback_data="srv_boshqa")],
        ]
    )

    await message.answer(
        f"🚗 Mashina: *{message.text}*\n\nSizga aynan qanday xizmat, kalit yoki pult kerak? Quyidagilardan tanlang:",
        parse_mode="Markdown",
        reply_markup=service_kb
    )

# 3. Xizmat turi tanlanganda
@dp.callback_query(OrderState.waiting_service_type, F.data.startswith("srv_"))
async def service_selected(call: types.CallbackQuery, state: FSMContext):
    service_names = {
        "srv_yangi_kalit": "🔑 Yangi kalit yasash",
        "srv_dublikat": "🗝 Kalit nusxalash (dublikat)",
        "srv_pult": "🚨 Yangi pult / dasturlash",
        "srv_ochish": "🚪 Qulflanib qolgan eshikni ochish",
        "srv_boshqa": "⚙️ Boshqa muammo"
    }

    selected = service_names.get(call.data, "Boshqa")
    await state.update_data(service_type=selected)
    await state.set_state(OrderState.waiting_problem_details)

    await call.answer()
    await call.message.answer(
        f"Tanlandi: *{selected}*\n\nEndi qanday muammo bo'layotganini batafsilroq yozib bering:\n(Masalan: Kalit butunlay yo'qolganmi, pult ishlamay qoldimi, chipi kuyganmi yoki mashina ichida qolganmi?)\n\n*Xohlasangiz rasm yoki ovozli xabar ham tashlashingiz mumkin.*",
        parse_mode="Markdown",
        reply_markup=cancel_kb
    )

# 4. Muammo tavsifi (matn, rasm yoki ovoz)
@dp.message(OrderState.waiting_problem_details)
async def problem_details_received(message: types.Message, state: FSMContext):
    media_id = None
    media_type = None

    if message.photo:
        media_id = message.photo[-1].file_id
        media_type = "photo"
        details = message.caption or "(Rasm yuborildi)"
    elif message.voice:
        media_id = message.voice.file_id
        media_type = "voice"
        details = "(Ovozli xabar yuborildi)"
    else:
        details = message.text or "(Tavsif berilmagan)"

    await state.update_data(problem_details=details, media_id=media_id, media_type=media_type)
    await state.set_state(OrderState.waiting_phone)

    phone_kb = ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="📱 Telefon raqamimni yuborish", request_contact=True)],
            [KeyboardButton(text="❌ Bekor qilish")]
        ],
        resize_keyboard=True
    )

    await message.answer(
        "Iltimos, siz bilan tezda bog'lanishimiz uchun **telefon raqamingizni** yuboring yoki yozib qoldiring:",
        parse_mode="Markdown",
        reply_markup=phone_kb
    )

# 5. Telefon raqami qabul qilinganda va arizani yakunlash
@dp.message(OrderState.waiting_phone)
async def phone_received(message: types.Message, state: FSMContext):
    phone = message.contact.phone_number if message.contact else message.text
    data = await state.get_data()

    # Mijozga minnatdorchilik
    await message.answer(
        "✅ *Katta rahmat! Buyurtmangiz qabul qilindi.*\n\n"
        "O‘zbekistondagi №1 kalit ustasi arizangizni ko‘rib chiqib, tez orada siz bilan bog'lanadi yoki ko'rsatilgan manzilga yetib boradi! 🚗💨",
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardRemove()
    )

    # Adminga arizani yetkazish
    if ADMIN_ID and ADMIN_ID != "SIZNING_TELEGRAM_ID":
        user_name = message.from_user.full_name
        username = f"@{message.from_user.username}" if message.from_user.username else "Mavjud emas"

        car_val = data.get("car") or "Noma'lum"
        service_val = data.get("service_type") or "Noma'lum"
        problem_val = data.get("problem_details") or "Tavsif berilmagan"

        admin_text = (
            "🔔 *YANGI MUROJAAT / BUYURTMA!* 🔔\n"
            "━━━━━━━━━━━━━━━━━━━━━\n"
            f"👤 *Mijoz:* {user_name}\n"
            f"📱 *Username:* {username}\n"
            f"🆔 *Telegram ID:* `{message.from_user.id}`\n"
            f"📞 *Telefon:* `{phone}`\n"
            "━━━━━━━━━━━━━━━━━━━━━\n"
            f"🚗 *Avtomobil:* {car_val}\n"
            f"🛠 *Xizmat turi:* {service_val}\n"
            f"📝 *Muammo tavsifi:*\n{problem_val}\n"
            "━━━━━━━━━━━━━━━━━━━━━\n"
            "📍 *Mijoz lokatsiyasi quyida yuborildi:*"
        )

        try:
            await bot.send_message(ADMIN_ID, admin_text, parse_mode="Markdown")

            if "latitude" in data and "longitude" in data:
                await bot.send_location(ADMIN_ID, data["latitude"], data["longitude"])

            if data.get("media_id"):
                if data["media_type"] == "photo":
                    await bot.send_photo(ADMIN_ID, photo=data["media_id"], caption="📷 Mijoz yuborgan rasm")
                elif data["media_type"] == "voice":
                    await bot.send_voice(ADMIN_ID, voice=data["media_id"], caption="🎤 Mijoz ovozli xabari")
        except Exception as e:
            logging.error(f"Adminga yuborishda xatolik: {e}")

    await state.clear()

async def handle_ping(request):
    return web.Response(text="Bot is running!")

async def start_web_server():
    port = int(os.environ.get("PORT", 8080))
    app = web.Application()
    app.router.add_get("/", handle_ping)
    app.router.add_get("/health", handle_ping)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    logging.info(f"Health check server running on port {port}")

async def main():
    print("==========================================")
    print("🚀 Python Kalit yasovchi bot ishga tushmoqda...")
    print("==========================================")
    
    # Render Web Service portini ochish (deploy muvaffaqiyatli bo'lishi uchun)
    if "PORT" in os.environ:
        await start_web_server()
        
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
