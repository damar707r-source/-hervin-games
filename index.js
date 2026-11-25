
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const games = new Map();

const MAX_PLAYERS = 20;
const REGISTER_TIME = 60;

function rouletteEmbed(game) {
  return new EmbedBuilder()
    .setColor("#777777")
    .setTitle("🎰 HERVIN ROULETTE")
    .setDescription(
      `**التسجيل في لعبة الروليت**\n\n` +
      `⏱️ الوقت المتبقي: **${game.timeLeft} ثانية**\n` +
      `👥 اللاعبين: **${game.players.length}/${MAX_PLAYERS}**\n\n` +
      (game.players.length
        ? game.players.map((p, i) => `**${i + 1}.** <@${p}>`).join("\n")
        : "بانتظار دخول اللاعبين...")
    )
    .setFooter({ text: "HERVIN GAMES • Roulette" });
}

function gameButtons(game) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("roulette_join")
      .setLabel("دخول اللعبة")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Success)
      .setDisabled(game.closed || game.players.length >= MAX_PLAYERS),

    new ButtonBuilder()
      .setCustomId("roulette_start")
      .setLabel("بدء اللعبة")
      .setEmoji("🎰")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(game.players.length < 2),

    new ButtonBuilder()
      .setCustomId("roulette_cancel")
      .setLabel("إلغاء")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
  );
}

async function startRoulette(game) {
  if (game.closed || game.players.length < 2) return;

  game.closed = true;
  clearInterval(game.timer);

  const message = await game.message.fetch();
  await message.edit({
    embeds: [
      new EmbedBuilder()
        .setColor("#777777")
        .setTitle("🎰 HERVIN ROULETTE")
        .setDescription("**بدأت الجولة!**\n\n🎡 العجلة تدور...")
    ],
    components: []
  });

  while (game.players.length > 1) {
    const index = Math.floor(Math.random() * game.players.length);
    const eliminated = game.players.splice(index, 1)[0];

    await message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor("#777777")
          .setTitle("🎡 نتيجة الروليت")
          .setDescription(
            `**تم اختيار اللاعب:**\n\n` +
            `<@${eliminated}>\n\n` +
            `❌ تم استبعاده من اللعبة\n` +
            `👥 المتبقون: **${game.players.length}**`
          )
      ]
    });

    await new Promise(resolve => setTimeout(resolve, 3500));
  }

  await message.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor("#D4AF37")
        .setTitle("🏆 الفائز في الروليت")
        .setDescription(`👑 الفائز هو <@${game.players[0]}>`)
        .setFooter({ text: "HERVIN GAMES" })
    ]
  });

  games.delete(game.channelId);
}

client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;

  const command = message.content.trim();

  if (command === "روليت") {
    if (games.has(message.channel.id)) {
      return message.reply("⚠️ توجد لعبة روليت قائمة بالفعل في هذا الروم");
    }

    const game = {
      channelId: message.channel.id,
      players: [],
      timeLeft: REGISTER_TIME,
      closed: false,
      message: null,
      timer: null
    };

    const panel = await message.channel.send({
      embeds: [rouletteEmbed(game)],
      components: [gameButtons(game)]
    });

    game.message = panel;
    games.set(message.channel.id, game);

    game.timer = setInterval(async () => {
      if (game.closed) return;

      game.timeLeft--;

      if (game.timeLeft <= 0) {
        clearInterval(game.timer);
        game.closed = true;

        await panel.edit({
          embeds: [
            new EmbedBuilder()
              .setColor("#777777")
              .setTitle("🎰 انتهى التسجيل")
              .setDescription(
                `👥 عدد اللاعبين: **${game.players.length}**\n\n` +
                (game.players.length >= 2
                  ? "يمكن للإداري بدء اللعبة الآن"
                  : "لا يوجد عدد كافٍ لبدء اللعبة")
              )
          ],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("roulette_start")
                .setLabel("بدء اللعبة")
                .setEmoji("🎰")
                .setStyle(ButtonStyle.Primary)
                .setDisabled(game.players.length < 2)
            )
          ]
        });

        return;
      }

      await panel.edit({
        embeds: [rouletteEmbed(game)],
        components: [gameButtons(game)]
      }).catch(() => {});
    }, 1000);
  }

  if (command === "مافيا") {
    await message.reply(
      "🔪 **HERVIN MAFIA**\n\nنظام المافيا قيد التجهيز، وسيتم تفعيله في الإصدار القادم"
    );
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  const game = games.get(interaction.channelId);
  if (!game) return;

  if (interaction.customId === "roulette_join") {
    if (game.closed) {
      return interaction.reply({
        content: "❌ التسجيل مغلق",
        ephemeral: true
      });
    }

    if (game.players.includes(interaction.user.id)) {
      return interaction.reply({
        content: "أنت مسجل بالفعل!",
        ephemeral: true
      });
    }

    if (game.players.length >= MAX_PLAYERS) {
      return interaction.reply({
        content: "اكتمل العدد، الحد الأقصى 20 لاعب",
        ephemeral: true
      });
    }

    game.players.push(interaction.user.id);

    await interaction.update({
      embeds: [rouletteEmbed(game)],
      components: [gameButtons(game)]
    });

    return;
  }

  if (interaction.customId === "roulette_start") {
    if (!interaction.memberPermissions?.has("Administrator")) {
      return interaction.reply({
        content: "❌ بدء اللعبة متاح للإداريين فقط",
        ephemeral: true
      });
    }

    if (game.players.length < 2) {
      return interaction.reply({
        content: "تحتاج لاعبين اثنين على الأقل",
        ephemeral: true
      });
    }

    await interaction.deferUpdate();
    await startRoulette(game);
    return;
  }

  if (interaction.customId === "roulette_cancel") {
    if (!interaction.memberPermissions?.has("Administrator")) {
      return interaction.reply({
        content: "❌ الإلغاء متاح للإداريين فقط",
        ephemeral: true
      });
    }

    clearInterval(game.timer);
    games.delete(game.channelId);

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor("#777777")
          .setTitle("❌ تم إلغاء الروليت")
      ],
      components: []
    });
  }
});

client.once(Events.ClientReady, () => {
  console.log(`HERVIN GAMES ONLINE: ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
