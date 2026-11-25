const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  PermissionsBitField
} = require("discord.js");

const { createCanvas } = require("@napi-rs/canvas");
const GIFEncoder = require("gifencoder");

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error("DISCORD_TOKEN is missing!");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

const games = new Map();

const MAX_PLAYERS = 20;
const LOBBY_SECONDS = 60;
const NIGHT_SECONDS = 30;
const VOTE_SECONDS = 45;

const COLORS = {
  purple: 0x7138c8,
  dark: 0x171421,
  green: 0x28a745,
  red: 0xe74c3c,
  gold: 0xf1c40f
};

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function getGame(channelId) {
  return games.get(channelId);
}

function isManager(member) {
  return member?.permissions?.has(
    PermissionsBitField.Flags.ManageGuild
  );
}

function clearGameTimer(game) {
  if (game?.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }
}

function playerName(player) {
  return player.username || player.id;
}

async function replyPrivate(interaction, content, components = []) {
  const payload = {
    content,
    components,
    ephemeral: true
  };

  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload).catch(() => {});
  }

  return interaction.reply(payload).catch(() => {});
}

function playerSelect(customId, players, placeholder) {
  const options = players.slice(0, 25).map(player => ({
    label: playerName(player).slice(0, 100),
    value: player.id,
    description: `اللاعب: ${playerName(player)}`.slice(0, 100)
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options)
  );
}

// =====================================
// LOBBY EMBEDS
// =====================================

function mafiaLobbyEmbed(game) {
  const players = game.players
    .map((p, i) => `${i + 1}. <@${p.id}>`)
    .join("\n") || "لا يوجد لاعبون حتى الآن";

  return new EmbedBuilder()
    .setColor(COLORS.purple)
    .setTitle("🎭 HERVIN MAFIA")
    .setDescription(
      "مرحبًا بك في لعبة المافيا!\n\n" +
      "انضم إلى اللعبة وانتظر بدء الجولة.\n" +
      "سيتم توزيع الأدوار بشكل سري بعد البدء.\n\n" +
      `**اللاعبون (${game.players.length}/${MAX_PLAYERS}):**\n${players}\n\n` +
      `**حالة التسجيل:** ${game.closed ? "مغلق" : "مفتوح"}`
    )
    .setFooter({ text: "HERVIN GAMES • Mafia" });
}

function mafiaLobbyRows(game) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`m:join:${game.channelId}`)
        .setLabel("دخول اللعبة")
        .setEmoji("➕")
        .setStyle(ButtonStyle.Success)
        .setDisabled(game.closed),

      new ButtonBuilder()
        .setCustomId(`m:leave:${game.channelId}`)
        .setLabel("خروج")
        .setEmoji("🚪")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(game.closed),

      new ButtonBuilder()
        .setCustomId(`m:start:${game.channelId}`)
        .setLabel("بدء اللعبة")
        .setEmoji("▶️")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId(`m:help:${game.channelId}`)
        .setLabel("شرح اللعبة")
        .setEmoji("📖")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function rouletteLobbyEmbed(game) {
  const players = game.players
    .map((p, i) => `${i + 1}. <@${p.id}>`)
    .join("\n") || "لا يوجد لاعبون حتى الآن";

  return new EmbedBuilder()
    .setColor(COLORS.dark)
    .setTitle("🎡 HERVIN ROULETTE")
    .setDescription(
      "العجلة تختار لاعبًا ليكون المتحكم في الجولة.\n" +
      "المتحكم يختار بنفسه اللاعب الذي سيتم إقصاؤه.\n\n" +
      `**المشاركون (${game.players.length}/${MAX_PLAYERS}):**\n${players}\n\n` +
      `**التسجيل:** ${game.closed ? "مغلق" : "مفتوح"}`
    )
    .setFooter({ text: "HERVIN GAMES • Roulette" });
}

function rouletteLobbyRows(game) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`r:join:${game.channelId}`)
        .setLabel("دخول اللعبة")
        .setEmoji("➕")
        .setStyle(ButtonStyle.Success)
        .setDisabled(game.closed),

      new ButtonBuilder()
        .setCustomId(`r:leave:${game.channelId}`)
        .setLabel("خروج")
        .setEmoji("🚪")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(game.closed),

      new ButtonBuilder()
        .setCustomId(`r:start:${game.channelId}`)
        .setLabel("بدء الروليت")
        .setEmoji("🎡")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

async function refreshLobby(game) {
  if (!game.message) return;

  const embed = game.type === "mafia"
    ? mafiaLobbyEmbed(game)
    : rouletteLobbyEmbed(game);

  // نحافظ على صورة العد التنازلي عند تحديث قائمة اللاعبين
  embed.setImage("attachment://countdown.gif");

  const rows = game.type === "mafia"
    ? mafiaLobbyRows(game)
    : rouletteLobbyRows(game);

  await game.message.edit({
    embeds: [embed],
    components: rows
  }).catch(() => {});
}

// =====================================
// COUNTDOWN GIF
// =====================================

async function makeCountdownGif() {
  const width = 600;
  const height = 180;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const encoder = new GIFEncoder(width, height);
  const chunks = [];

  const stream = encoder.createReadStream();

  stream.on("data", chunk => chunks.push(chunk));

  const finished = new Promise((resolve, reject) => {
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });

  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(1000);
  encoder.setQuality(10);

  for (let seconds = 60; seconds >= 0; seconds--) {
    ctx.fillStyle = "#171421";
    ctx.fillRect(0, 0, width, height);

    ctx.beginPath();
    ctx.arc(300, 90, 70, 0, Math.PI * 2);
    ctx.fillStyle = "#28213b";
    ctx.fill();

    ctx.lineWidth = 8;
    ctx.strokeStyle = "#8b5cf6";

    ctx.beginPath();
    ctx.arc(
      300,
      90,
      70,
      -Math.PI / 2,
      -Math.PI / 2 + (seconds / 60) * Math.PI * 2
    );
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 58px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(seconds), 300, 90);

    encoder.addFrame(ctx);
  }

  encoder.finish();

  return finished;
}

// =====================================
// CREATE GAME LOBBY
// =====================================

async function createLobby(message, type) {
  const channelId = message.channel.id;

  if (games.has(channelId)) {
    return message.reply("⚠️ توجد لعبة نشطة في هذا الروم بالفعل");
  }

  const game = {
    id: makeId(),
    type,
    channelId,
    guildId: message.guild.id,
    hostId: message.author.id,
    players: [],
    alive: [],
    closed: false,
    started: false,
    ended: false,
    message: null,
    timer: null,
    phase: null
  };

  games.set(channelId, game);

  try {
    const gif = await makeCountdownGif();

    const attachment = new AttachmentBuilder(gif, {
      name: "countdown.gif"
    });

    const embed = type === "mafia"
      ? mafiaLobbyEmbed(game)
      : rouletteLobbyEmbed(game);

    embed.setImage("attachment://countdown.gif");

    const rows = type === "mafia"
      ? mafiaLobbyRows(game)
      : rouletteLobbyRows(game);

    game.message = await message.channel.send({
      embeds: [embed],
      files: [attachment],
      components: rows
    });

    game.timer = setTimeout(async () => {
      if (game.started || game.ended) return;

      game.closed = true;
      await refreshLobby(game);

      await message.channel.send(
        `⏰ انتهى وقت التسجيل في ${type === "mafia" ? "المافيا" : "الروليت"}`
      );

      // حذف اللعبة إذا لم يبدأها أحد
      if (!game.started && !game.ended) {
        games.delete(channelId);
      }
    }, LOBBY_SECONDS * 1000);

  } catch (error) {
    console.error("Create lobby error:", error);
    games.delete(channelId);
    await message.reply("تعذر إنشاء اللعبة، تحقق من سجل التشغيل").catch(() => {});
  }
}

// =====================================
// MAFIA ROLES
// =====================================

function getRoleCounts(count) {
  const mafia = Math.max(1, Math.floor(count / 4));

  return {
    mafia,
    doctor: 1,
    detective: 1,
    citizen: count - mafia - 2
  };
}

function distributeRoles(game) {
  const counts = getRoleCounts(game.players.length);
  const roles = [];

  for (let i = 0; i < counts.mafia; i++) {
    roles.push("mafia");
  }

  roles.push("doctor", "detective");

  for (let i = 0; i < counts.citizen; i++) {
    roles.push("citizen");
  }

  const shuffled = shuffle(roles);

  game.roles = new Map();

  game.players.forEach((player, index) => {
    game.roles.set(player.id, shuffled[index]);
  });

  game.alive = game.players.map(player => player.id);
}

function roleInfo(role) {
  const info = {
    mafia: {
      name: "المافيا 🔪",
      description: "مهمتك التخلص من المواطنين دون أن يكتشفك الآخرون"
    },
    doctor: {
      name: "الطبيب 💉",
      description: "مهمتك حماية لاعب واحد في كل ليلة من القتل"
    },
    detective: {
      name: "الشرطي 👮",
      description: "مهمتك التحقيق في لاعب لمعرفة هل هو من المافيا أم لا"
    },
    citizen: {
      name: "المواطن 🧑‍🌾",
      description: "حلل تصرفات اللاعبين وناقشهم وصوّت لكشف المافيا"
    }
  };

  return info[role];
}

function getAlivePlayers(game) {
  return game.players.filter(player =>
    game.alive.includes(player.id)
  );
}

function getRolePlayers(game, role) {
  return getAlivePlayers(game).filter(player =>
    game.roles.get(player.id) === role
  );
}

function getMafiaCount(game) {
  return getRolePlayers(game, "mafia").length;
}

function getCitizenSideCount(game) {
  return getAlivePlayers(game).filter(player =>
    game.roles.get(player.id) !== "mafia"
  ).length;
}

function mafiaStatusText(game) {
  return getAlivePlayers(game)
    .map(player => `• <@${player.id}>`)
    .join("\n") || "لا يوجد لاعبون";
}

function mafiaMainRows(game) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`m:role:${game.channelId}`)
        .setLabel("عرض دوري السري")
        .setEmoji("🔐")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId(`m:action:${game.channelId}`)
        .setLabel("تنفيذ دوري")
        .setEmoji("🎯")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}
// =====================================
// START MAFIA
// =====================================

async function startMafia(interaction, game) {
  if (game.players.length < 4) {
    return replyPrivate(interaction, "❌ تحتاج اللعبة إلى 4 لاعبين على الأقل");
  }

  clearGameTimer(game);

  game.started = true;
  game.closed = true;
  game.channel = interaction.channel;

  distributeRoles(game);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.purple)
        .setTitle("🎭 بدأت لعبة المافيا")
        .setDescription(
          "تم توزيع الأدوار بشكل سري\n\n" +
          "اضغط **عرض دوري السري** لمعرفة دورك\n" +
          "وعندما يحين دورك اضغط **تنفيذ دوري**\n\n" +
          `**عدد المشاركين:** ${game.players.length}\n\n` +
          `**الأحياء:**\n${mafiaStatusText(game)}`
        )
    ],
    components: mafiaMainRows(game)
  });

  await startMafiaNight(game);
}

// =====================================
// PHASE TIMER
// =====================================

async function startPhaseTimer(game, seconds, callback) {
  clearGameTimer(game);

  const phaseAtStart = game.phase;

  game.timer = setTimeout(async () => {
    if (
      game.ended ||
      game.phase !== phaseAtStart
    ) return;

    try {
      await callback();
    } catch (error) {
      console.error("Phase timer error:", error);
    }
  }, seconds * 1000);
}

// =====================================
// MAFIA NIGHT
// =====================================

async function startMafiaNight(game) {
  if (game.ended) return;

  clearGameTimer(game);

  game.phase = "mafia";
  game.mafiaVotes = new Map();
  game.protectedId = null;
  game.killedId = null;
  game.detectiveResult = null;
  game.doctorSubmitted = false;
  game.detectiveSubmitted = false;

  await game.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.dark)
        .setTitle("🌙 دور المافيا")
        .setDescription(
          "استيقظت المافيا...\n\n" +
          "على أفراد المافيا اختيار لاعب واحد للتخلص منه\n" +
          "اضغط **تنفيذ دوري** لاختيار الضحية"
        )
    ]
  });

  await startPhaseTimer(game, NIGHT_SECONDS, async () => {
    await startDoctorPhase(game);
  });
}

// =====================================
// DOCTOR PHASE
// =====================================

async function startDoctorPhase(game) {
  if (game.ended) return;

  clearGameTimer(game);

  const doctors = getRolePlayers(game, "doctor");

  if (!doctors.length) {
    return startDetectivePhase(game);
  }

  game.phase = "doctor";
  game.doctorChoice = null;
  game.doctorSubmitted = false;

  await game.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.green)
        .setTitle("💉 دور الطبيب")
        .setDescription(
          "جاء دور الطبيب\n\n" +
          "اختر لاعبًا واحدًا لحمايته من القتل\n" +
          "يمكنك حماية نفسك أيضًا"
        )
    ]
  });

  await startPhaseTimer(game, NIGHT_SECONDS, async () => {
    await startDetectivePhase(game);
  });
}

// =====================================
// DETECTIVE PHASE
// =====================================

async function startDetectivePhase(game) {
  if (game.ended) return;

  clearGameTimer(game);

  const detectives = getRolePlayers(game, "detective");

  if (!detectives.length) {
    return resolveMafiaNight(game);
  }

  game.phase = "detective";
  game.detectiveChoice = null;
  game.detectiveSubmitted = false;

  await game.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.gold)
        .setTitle("👮 دور الشرطي")
        .setDescription(
          "جاء دور الشرطي\n\n" +
          "اختر لاعبًا للتحقيق معه\n" +
          "ستظهر لك النتيجة بشكل سري"
        )
    ]
  });

  await startPhaseTimer(game, NIGHT_SECONDS, async () => {
    await resolveMafiaNight(game);
  });
}

// =====================================
// RESOLVE NIGHT
// =====================================

async function resolveMafiaNight(game) {
  if (game.ended || game.phase === "resolving") return;

  clearGameTimer(game);
  game.phase = "resolving";

  const votes = [...game.mafiaVotes.values()];
  const counts = new Map();

  for (const id of votes) {
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  let targetId = null;

  if (counts.size) {
    const highest = Math.max(...counts.values());

    const leaders = [...counts.entries()]
      .filter(([, count]) => count === highest)
      .map(([id]) => id);

    if (leaders.length === 1) {
      targetId = leaders[0];
    }
  }

  game.killedId = targetId;

  if (targetId && targetId !== game.protectedId) {
    game.alive = game.alive.filter(id => id !== targetId);

    await game.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.red)
          .setTitle("💀 نتيجة الليلة")
          .setDescription(
            `تم قتل <@${targetId}> هذه الليلة\n` +
            "لقد خرج من اللعبة"
          )
      ]
    });
  } else if (targetId && targetId === game.protectedId) {
    await game.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.green)
          .setTitle("🛡️ نجاة!")
          .setDescription(
            "حاولت المافيا قتل أحد اللاعبين، لكن الطبيب أنقذه"
          )
      ]
    });
  } else {
    await game.channel.send("🌙 انتهت الليلة دون تنفيذ عملية قتل");
  }

  if (await checkMafiaWinner(game)) return;

  await startMafiaDay(game);
}

// =====================================
// DAY AND VOTING
// =====================================

async function startMafiaDay(game) {
  if (game.ended) return;

  clearGameTimer(game);

  game.phase = "day";
  game.dayVotes = new Map();

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle("☀️ وقت النقاش والتصويت")
    .setDescription(
      "اجتمع اللاعبون الأحياء لمناقشة المشتبه بهم\n\n" +
      "اضغط زر التصويت واختر الشخص الذي تريد طرده\n" +
      "ستظهر أعداد الأصوات للجميع\n\n" +
      `**اللاعبون الأحياء:**\n${mafiaStatusText(game)}`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`m:vote:${game.channelId}`)
      .setLabel("التصويت")
      .setEmoji("🗳️")
      .setStyle(ButtonStyle.Primary)
  );

  await game.channel.send({
    embeds: [embed],
    components: [row]
  });

  // إنشاء لوحة الأصوات فعليًا قبل تحديثها
  game.voteMessage = await game.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.gold)
        .setTitle("🗳️ التصويت الجاري")
        .setDescription("لم يتم تسجيل أي أصوات حتى الآن")
    ]
  });

  await refreshMafiaVoteBoard(game);

  await startPhaseTimer(game, VOTE_SECONDS, async () => {
    await finishMafiaVote(game);
  });
}

async function refreshMafiaVoteBoard(game) {
  if (!game.voteMessage || !game.dayVotes) return;

  const counts = new Map();

  for (const target of game.dayVotes.values()) {
    counts.set(target, (counts.get(target) || 0) + 1);
  }

  const lines = getAlivePlayers(game).map(player => {
    const count = counts.get(player.id) || 0;
    return `• <@${player.id}> — **${count}** صوت`;
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle("🗳️ التصويت الجاري")
    .setDescription(
      lines.join("\n") +
      `\n\n**الأصوات المسجلة:** ${game.dayVotes.size}/${game.alive.length}`
    );

  await game.voteMessage.edit({
    embeds: [embed]
  }).catch(() => {});
}

// =====================================
// FINISH VOTING
// =====================================

async function finishMafiaVote(game) {
  if (game.ended || game.phase !== "day") return;

  clearGameTimer(game);
  game.phase = "resolving_vote";

  const counts = new Map();

  for (const target of game.dayVotes.values()) {
    counts.set(target, (counts.get(target) || 0) + 1);
  }

  if (!counts.size) {
    await game.channel.send(
      "🗳️ لم يصوّت أحد، لذلك لم يتم طرد أي لاعب"
    );
  } else {
    const highest = Math.max(...counts.values());

    const leaders = [...counts.entries()]
      .filter(([, count]) => count === highest)
      .map(([id]) => id);

    if (leaders.length === 1) {
      const expelled = leaders[0];

      game.alive = game.alive.filter(id => id !== expelled);

      await game.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.red)
            .setTitle("🚪 تم طرد لاعب")
            .setDescription(
              `تم طرد <@${expelled}> من اللعبة بسبب التصويت`
            )
        ]
      });
    } else {
      await game.channel.send(
        "⚖️ حدث تعادل في التصويت، لذلك لم يتم طرد أحد"
      );
    }
  }

  if (await checkMafiaWinner(game)) return;

  await startMafiaNight(game);
}

// =====================================
// CHECK WINNER
// =====================================

async function checkMafiaWinner(game) {
  if (game.ended) return true;

  const mafia = getMafiaCount(game);
  const others = getCitizenSideCount(game);

  let winner = null;

  if (mafia === 0) {
    winner = "المواطنون";
  } else if (mafia >= others) {
    winner = "المافيا";
  }

  if (!winner) return false;

  game.ended = true;
  clearGameTimer(game);

  const roleLines = game.players.map(player => {
    const role = roleInfo(game.roles.get(player.id));
    return `• <@${player.id}> — ${role.name}`;
  });

  await game.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.green)
        .setTitle(`🏆 فاز ${winner}!`)
        .setDescription(
          "انتهت لعبة المافيا!\n\n" +
          `**الأدوار الحقيقية:**\n${roleLines.join("\n")}`
        )
    ]
  });

  games.delete(game.channelId);

  return true;
}

// =====================================
// MAFIA ACTION MENU
// =====================================

async function openMafiaAction(interaction, game) {
  const userId = interaction.user.id;

  if (!game.alive.includes(userId)) {
    return replyPrivate(interaction, "❌ أنت خارج اللعبة");
  }

  const role = game.roles.get(userId);

  if (game.phase === "mafia" && role === "mafia") {
    const targets = getAlivePlayers(game).filter(player =>
      game.roles.get(player.id) !== "mafia"
    );

    if (!targets.length) {
      return replyPrivate(interaction, "لا يوجد لاعبون متاحون للاختيار");
    }

    return replyPrivate(
      interaction,
      "🔪 اختر اللاعب الذي تريد أن تستهدفه المافيا:",
      [
        playerSelect(
          `m:killselect:${game.channelId}`,
          targets,
          "اختر ضحية"
        )
      ]
    );
  }

  if (game.phase === "doctor" && role === "doctor") {
    return replyPrivate(
      interaction,
      "💉 اختر اللاعب الذي تريد حمايته:",
      [
        playerSelect(
          `m:doctorselect:${game.channelId}`,
          getAlivePlayers(game),
          "اختر لاعبًا للعلاج"
        )
      ]
    );
  }

  if (game.phase === "detective" && role === "detective") {
    const targets = getAlivePlayers(game).filter(p => p.id !== userId);

    return replyPrivate(
      interaction,
      "👮 اختر اللاعب الذي تريد التحقيق معه:",
      [
        playerSelect(
          `m:detectiveselect:${game.channelId}`,
          targets,
          "اختر لاعبًا للتحقيق"
        )
      ]
    );
  }

  if (game.phase === "day") {
    return replyPrivate(
      interaction,
      "🗳️ اضغط زر التصويت لاختيار اللاعب الذي تريد طرده"
    );
  }

  if (role === "citizen") {
    return replyPrivate(
      interaction,
      "🧑‍🌾 أنت مواطن، ناقش اللاعبين وحلل تصرفاتهم وصوّت أثناء النهار"
    );
  }

  return replyPrivate(
    interaction,
    "⏳ ليس دورك الآن، انتظر المرحلة الخاصة بدورك"
  );
}

// =====================================
// OPEN VOTE MENU
// =====================================

async function openMafiaVote(interaction, game) {
  if (game.phase !== "day") {
    return replyPrivate(interaction, "التصويت غير متاح الآن");
  }

  if (!game.alive.includes(interaction.user.id)) {
    return replyPrivate(interaction, "أنت خارج اللعبة ولا يمكنك التصويت");
  }

  const targets = getAlivePlayers(game).filter(player =>
    player.id !== interaction.user.id
  );

  if (!targets.length) {
    return replyPrivate(interaction, "لا يوجد لاعبون للتصويت عليهم");
  }

  return replyPrivate(
    interaction,
    "🗳️ اختر اللاعب الذي تريد طرده:",
    [
      playerSelect(
        `m:voteselect:${game.channelId}`,
        targets,
        "اختر لاعبًا للتصويت عليه"
      )
    ]
  );
}
// =====================================
// ROULETTE WHEEL GIF
// =====================================

async function makeWheelGif(players, winnerId) {
  const width = 600;
  const height = 600;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const encoder = new GIFEncoder(width, height);
  const chunks = [];

  const stream = encoder.createReadStream();

  stream.on("data", chunk => chunks.push(chunk));

  const finished = new Promise((resolve, reject) => {
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });

  const winnerIndex = players.findIndex(p => p.id === winnerId);
  const slice = (Math.PI * 2) / players.length;

  const finalAngle =
    -Math.PI / 2 -
    (winnerIndex * slice + slice / 2) +
    Math.PI * 2 * 5;

  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(120);
  encoder.setQuality(10);

  for (let frame = 0; frame < 30; frame++) {
    const progress = frame / 29;
    const eased = 1 - Math.pow(1 - progress, 3);
    const rotation = finalAngle * eased;

    ctx.fillStyle = "#171421";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(300, 300);
    ctx.rotate(rotation);

    for (let i = 0; i < players.length; i++) {
      const start = i * slice;
      const end = start + slice;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 235, start, end);
      ctx.closePath();

      ctx.fillStyle = i % 2 === 0 ? "#6338a8" : "#29223b";
      ctx.fill();

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.rotate(start + slice / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 17px Arial";

      let name = playerName(players[i]);

      if (name.length > 14) {
        name = name.slice(0, 12) + "...";
      }

      ctx.fillText(name, 215, 6);
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, Math.PI * 2);
    ctx.fillStyle = "#171421";
    ctx.fill();

    ctx.strokeStyle = "#f1c40f";
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("HERVIN", 0, 0);

    ctx.restore();

    // مؤشر العجلة
    ctx.beginPath();
    ctx.moveTo(300, 35);
    ctx.lineTo(280, 5);
    ctx.lineTo(320, 5);
    ctx.closePath();

    ctx.fillStyle = "#f1c40f";
    ctx.fill();
  }

  encoder.finish();

  return finished;
}

// =====================================
// START ROULETTE
// =====================================

async function startRoulette(interaction, game) {
  if (game.players.length < 2) {
    return replyPrivate(
      interaction,
      "❌ تحتاج الروليت إلى لاعبين على الأقل"
    );
  }

  clearGameTimer(game);

  game.started = true;
  game.closed = true;
  game.alive = game.players.map(player => player.id);
  game.channel = interaction.channel;

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.purple)
        .setTitle("🎡 بدأت الروليت")
        .setDescription(
          "العجلة ستختار المتحكم في كل جولة\n\n" +
          "المتحكم هو من يقرر اللاعب الذي سيتم إقصاؤه"
        )
    ],
    components: []
  });

  await spinRoulette(game);
}

// =====================================
// SPIN ROULETTE
// =====================================

async function spinRoulette(game) {
  if (game.ended) return;

  const alivePlayers = game.players.filter(player =>
    game.alive.includes(player.id)
  );

  if (alivePlayers.length <= 1) {
    game.ended = true;
    clearGameTimer(game);

    const winner = alivePlayers[0];

    await game.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.green)
          .setTitle("🏆 انتهت الروليت!")
          .setDescription(
            winner
              ? `الفائز هو <@${winner.id}> 🎉`
              : "انتهت اللعبة دون فائز"
          )
      ]
    });

    games.delete(game.channelId);
    return;
  }

  const controller =
    alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

  game.controllerId = controller.id;
  game.waitingForChoice = true;

  const gif = await makeWheelGif(alivePlayers, controller.id);

  const attachment = new AttachmentBuilder(gif, {
    name: "roulette-wheel.gif"
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.dark)
    .setTitle("🎡 عجلة HERVIN")
    .setDescription(
      "دارت العجلة وتوقفت عند:\n\n" +
      `🎯 **المتحكم:** <@${controller.id}>\n\n` +
      "المتحكم الآن يختار اللاعب الذي يريد إقصاءه"
    )
    .setImage("attachment://roulette-wheel.gif");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`r:control:${game.channelId}`)
      .setLabel("اختيار اللاعب المطرود")
      .setEmoji("⚖️")
      .setStyle(ButtonStyle.Danger)
  );

  game.wheelMessage = await game.channel.send({
    embeds: [embed],
    files: [attachment],
    components: [row]
  });
}

// =====================================
// ROULETTE CONTROLLER
// =====================================

async function openRouletteControl(interaction, game) {
  if (!game.started || game.ended || !game.waitingForChoice) {
    return replyPrivate(interaction, "لا توجد جولة اختيار نشطة الآن");
  }

  if (interaction.user.id !== game.controllerId) {
    return replyPrivate(
      interaction,
      "❌ العجلة لم تخترك متحكمًا في هذه الجولة"
    );
  }

  const targets = game.players.filter(player =>
    game.alive.includes(player.id) &&
    player.id !== game.controllerId
  );

  if (!targets.length) {
    return replyPrivate(interaction, "لا يوجد لاعبون متاحون للإقصاء");
  }

  return replyPrivate(
    interaction,
    "🎯 اختر اللاعب الذي تريد إقصاءه:",
    [
      playerSelect(
        `r:eliminate:${game.channelId}`,
        targets,
        "اختر اللاعب المطرود"
      )
    ]
  );
}

// =====================================
// ELIMINATE ROULETTE PLAYER
// =====================================

async function eliminateRoulettePlayer(interaction, game) {
  if (
    !game.waitingForChoice ||
    interaction.user.id !== game.controllerId
  ) {
    return replyPrivate(interaction, "❌ لا تملك صلاحية الاختيار");
  }

  const targetId = interaction.values[0];

  if (
    !game.alive.includes(targetId) ||
    targetId === game.controllerId
  ) {
    return replyPrivate(interaction, "هذا اللاعب غير متاح للاختيار");
  }

  game.waitingForChoice = false;
  game.alive = game.alive.filter(id => id !== targetId);

  await interaction.update({
    content: `✅ تم اختيار <@${targetId}> للإقصاء`,
    components: []
  });

  await game.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.red)
        .setTitle("🚪 تم إقصاء لاعب")
        .setDescription(
          `المتحكم <@${game.controllerId}> اختار إقصاء <@${targetId}>`
        )
    ]
  });

  await spinRoulette(game);
}

// =====================================
// INTERACTION HANDLER
// =====================================

client.on("interactionCreate", async interaction => {
  try {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) {
      return;
    }

    const parts = interaction.customId.split(":");
    const type = parts[0];
    const action = parts[1];
    const channelId = parts[2];

    const game = getGame(channelId);

    if (!game) {
      return replyPrivate(interaction, "انتهت اللعبة أو لم تعد موجودة");
    }

    if (type === "m" && game.type !== "mafia") return;
    if (type === "r" && game.type !== "roulette") return;

    // =================================
    // MAFIA BUTTONS
    // =================================

    if (type === "m" && interaction.isButton()) {

      if (action === "join") {
        if (game.started || game.closed) {
          return replyPrivate(interaction, "التسجيل مغلق");
        }

        if (game.players.some(p => p.id === interaction.user.id)) {
          return replyPrivate(interaction, "أنت مسجل بالفعل");
        }

        if (game.players.length >= MAX_PLAYERS) {
          return replyPrivate(interaction, "اكتمل العدد، الحد الأعلى 20 لاعبًا");
        }

        game.players.push({
          id: interaction.user.id,
          username: interaction.user.username
        });

        await refreshLobby(game);

        return replyPrivate(interaction, "✅ تم تسجيل دخولك في المافيا");
      }

      if (action === "leave") {
        if (game.started) {
          return replyPrivate(interaction, "لا يمكنك الخروج بعد بدء اللعبة");
        }

        const before = game.players.length;

        game.players = game.players.filter(p =>
          p.id !== interaction.user.id
        );

        if (before === game.players.length) {
          return replyPrivate(interaction, "أنت غير مسجل في اللعبة");
        }

        await refreshLobby(game);

        return replyPrivate(interaction, "تم إخراجك من قائمة المشاركين");
      }

      if (action === "help") {
        return replyPrivate(
          interaction,
          "**شرح لعبة المافيا 🎭**\n\n" +
          "🔪 المافيا: تختار لاعبًا لقتله\n" +
          "💉 الطبيب: يحمي لاعبًا من القتل\n" +
          "👮 الشرطي: يحقق في لاعب ويعرف إن كان من المافيا\n" +
          "🧑‍🌾 المواطن: يناقش ويصوّت لكشف المافيا\n\n" +
          "بعد الليل يبدأ التصويت، ثم تتكرر الجولات حتى يفوز أحد الفريقين"
        );
      }

      if (action === "start") {
        const allowed =
          interaction.user.id === game.hostId ||
          isManager(interaction.member);

        if (!allowed) {
          return replyPrivate(
            interaction,
            "❌ بدء اللعبة متاح لمنشئ اللعبة أو للإدارة فقط"
          );
        }

        if (game.started || game.ended) {
          return replyPrivate(interaction, "اللعبة بدأت بالفعل");
        }

        return startMafia(interaction, game);
      }

      if (action === "role") {
        if (!game.started) {
          return replyPrivate(interaction, "لم تبدأ اللعبة بعد");
        }

        const role = game.roles.get(interaction.user.id);

        if (!role) {
          return replyPrivate(interaction, "أنت لست مشاركًا في هذه اللعبة");
        }

        const info = roleInfo(role);

        return replyPrivate(
          interaction,
          `🔐 دورك السري هو: **${info.name}**\n\n${info.description}`
        );
      }

      if (action === "action") {
        if (!game.started || game.ended) {
          return replyPrivate(interaction, "لا توجد لعبة نشطة");
        }

        return openMafiaAction(interaction, game);
      }

      if (action === "vote") {
        return openMafiaVote(interaction, game);
      }
    }

    // =================================
    // ROULETTE BUTTONS
    // =================================

    if (type === "r" && interaction.isButton()) {

      if (action === "join") {
        if (game.started || game.closed) {
          return replyPrivate(interaction, "التسجيل مغلق");
        }

        if (game.players.some(p => p.id === interaction.user.id)) {
          return replyPrivate(interaction, "أنت مسجل بالفعل");
        }

        if (game.players.length >= MAX_PLAYERS) {
          return replyPrivate(interaction, "اكتمل العدد، الحد الأعلى 20 لاعبًا");
        }

        game.players.push({
          id: interaction.user.id,
          username: interaction.user.username
        });

        await refreshLobby(game);

        return replyPrivate(interaction, "✅ دخلت الروليت");
      }

      if (action === "leave") {
        if (game.started) {
          return replyPrivate(interaction, "لا يمكنك الخروج بعد بدء اللعبة");
        }

        const before = game.players.length;

        game.players = game.players.filter(p =>
          p.id !== interaction.user.id
        );

        if (before === game.players.length) {
          return replyPrivate(interaction, "أنت غير مسجل");
        }

        await refreshLobby(game);

        return replyPrivate(interaction, "تم إخراجك من الروليت");
      }

      if (action === "start") {
        const allowed =
          interaction.user.id === game.hostId ||
          isManager(interaction.member);

        if (!allowed) {
          return replyPrivate(
            interaction,
            "❌ بدء الروليت متاح لمنشئ اللعبة أو للإدارة فقط"
          );
        }

        if (game.started || game.ended) {
          return replyPrivate(interaction, "الروليت بدأت بالفعل");
        }

        return startRoulette(interaction, game);
      }

      if (action === "control") {
        return openRouletteControl(interaction, game);
      }
    }

    // =================================
    // MAFIA SELECT MENUS
    // =================================

    if (type === "m" && interaction.isStringSelectMenu()) {
      const selectedId = interaction.values[0];
      const userId = interaction.user.id;

      if (!game.alive.includes(userId)) {
        return replyPrivate(interaction, "أنت خارج اللعبة");
      }

      if (action === "killselect") {
        if (
          game.phase !== "mafia" ||
          game.roles.get(userId) !== "mafia"
        ) {
          return replyPrivate(interaction, "ليس دور المافيا الآن");
        }

        if (!game.alive.includes(selectedId)) {
          return replyPrivate(interaction, "اللاعب المختار لم يعد في اللعبة");
        }

        if (game.roles.get(selectedId) === "mafia") {
          return replyPrivate(interaction, "لا يمكنك اختيار فرد من المافيا");
        }

        game.mafiaVotes.set(userId, selectedId);

        await interaction.update({
          content: "🔪 تم تسجيل اختيارك للمافيا",
          components: []
        });

        const mafiaPlayers = getRolePlayers(game, "mafia");

        if (mafiaPlayers.every(p => game.mafiaVotes.has(p.id))) {
          await startDoctorPhase(game);
        }

        return;
      }

      if (action === "doctorselect") {
        if (
          game.phase !== "doctor" ||
          game.roles.get(userId) !== "doctor" ||
          game.doctorSubmitted
        ) {
          return replyPrivate(interaction, "ليس دور الطبيب الآن أو تم اختيار الحماية بالفعل");
        }

        if (!game.alive.includes(selectedId)) {
          return replyPrivate(interaction, "اللاعب لم يعد في اللعبة");
        }

        game.protectedId = selectedId;
        game.doctorSubmitted = true;

        await interaction.update({
          content: `💉 اخترت حماية <@${selectedId}> هذه الليلة`,
          components: []
        });

        await startDetectivePhase(game);
        return;
      }

      if (action === "detectiveselect") {
        if (
          game.phase !== "detective" ||
          game.roles.get(userId) !== "detective" ||
          game.detectiveSubmitted
        ) {
          return replyPrivate(interaction, "ليس دور الشرطي الآن أو تم التحقيق بالفعل");
        }

        if (!game.alive.includes(selectedId)) {
          return replyPrivate(interaction, "اللاعب لم يعد في اللعبة");
        }

        game.detectiveSubmitted = true;

        const isMafia = game.roles.get(selectedId) === "mafia";

        await interaction.update({
          content:
            `👮 نتيجة التحقيق مع <@${selectedId}>:\n\n` +
            (isMafia
              ? "🚨 هذا اللاعب من المافيا!"
              : "✅ هذا اللاعب ليس من المافيا"),
          components: []
        });

        await resolveMafiaNight(game);
        return;
      }

      if (action === "voteselect") {
        if (game.phase !== "day") {
          return replyPrivate(interaction, "انتهى وقت التصويت");
        }

        if (!game.alive.includes(selectedId)) {
          return replyPrivate(interaction, "اللاعب لم يعد في اللعبة");
        }

        if (selectedId === userId) {
          return replyPrivate(interaction, "لا يمكنك التصويت لنفسك");
        }

        if (game.dayVotes.has(userId)) {
          return replyPrivate(interaction, "لقد سجلت تصويتك بالفعل");
        }

        game.dayVotes.set(userId, selectedId);

        await interaction.update({
          content: `🗳️ تم تسجيل تصويتك على <@${selectedId}>`,
          components: []
        });

        await refreshMafiaVoteBoard(game);

        if (game.alive.every(id => game.dayVotes.has(id))) {
          await finishMafiaVote(game);
        }

        return;
      }
    }

    // =================================
    // ROULETTE SELECT MENU
    // =================================

    if (type === "r" && interaction.isStringSelectMenu()) {
      if (action === "eliminate") {
        return eliminateRoulettePlayer(interaction, game);
      }
    }

  } catch (error) {
    console.error("Interaction error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "حدث خطأ أثناء تنفيذ طلبك، حاول مرة أخرى",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// =====================================
// MESSAGE COMMANDS
// =====================================

client.on("messageCreate", async message => {
  try {
    if (message.author.bot || !message.guild) return;

    const command = message.content.trim().toLowerCase();

    if (command === "مافيا") {
      return createLobby(message, "mafia");
    }

    if (command === "روليت") {
      return createLobby(message, "roulette");
    }

  } catch (error) {
    console.error("Message error:", error);
    message.reply("حدث خطأ أثناء إنشاء اللعبة").catch(() => {});
  }
});

// =====================================
// READY
// =====================================

client.once("ready", () => {
  console.log("--------------------------------");
  console.log("HERVIN GAMES IS ONLINE");
  console.log(`Logged in as ${client.user.tag}`);
  console.log("--------------------------------");

  client.user.setActivity("مافيا 🎭 | روليت 🎡");
});

client.login(TOKEN);
