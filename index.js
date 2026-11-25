const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  Events
} = require('discord.js');

const { createCanvas } = require('@napi-rs/canvas');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const games = new Map();

const MAX_PLAYERS = 20;
const REGISTER_SECONDS = 60;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const randomItem = arr => arr[Math.floor(Math.random() * arr.length)];
const mention = id => `<@${id}>`;

const isAdmin = interaction =>
  interaction.memberPermissions?.has('Administrator');

function baseEmbed(title, description, color = '#777777') {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'HERVIN GAMES' });
}

function buttons(...items) {
  return new ActionRowBuilder().addComponents(...items);
}

function button(id, label, emoji, style, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(style)
    .setDisabled(disabled);
}

// ================================
// ROULETTE
// ================================

function roulettePanel(game) {
  const list = game.players.length
    ? game.players.map((id, i) => `**${i + 1}.** ${mention(id)}`).join('\n')
    : 'بانتظار دخول اللاعبين...';

  return baseEmbed(
    '🎰 HERVIN ROULETTE',
    `**التسجيل في لعبة الروليت**\n\n` +
    `⏱️ الوقت المتبقي: **${game.timeLeft} ثانية**\n` +
    `👥 اللاعبين: **${game.players.length}/${MAX_PLAYERS}**\n\n` +
    list
  );
}

function rouletteControls(game) {
  return buttons(
    button(
      'roulette_join',
      'دخول اللعبة',
      '➕',
      ButtonStyle.Success,
      game.registrationClosed ||
      game.started ||
      game.players.length >= MAX_PLAYERS
    ),

    button(
      'roulette_start',
      'بدء اللعبة',
      '🎰',
      ButtonStyle.Primary,
      game.players.length < 2 || game.started
    ),

    button(
      'roulette_cancel',
      'إلغاء',
      '❌',
      ButtonStyle.Danger,
      game.started
    )
  );
}

// رسم العجلة

function drawWheel(players, rotation = 0, names = new Map()) {
  const size = 900;
  const center = size / 2;
  const radius = 390;

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#252525';
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.translate(center, center);

  const slice = (Math.PI * 2) / players.length;

  const palette = [
    '#777777',
    '#555555',
    '#8a8a8a',
    '#444444',
    '#686868'
  ];

  players.forEach((id, i) => {
    const start = rotation + i * slice;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, start + slice);
    ctx.closePath();

    ctx.fillStyle = palette[i % palette.length];
    ctx.fill();

    ctx.strokeStyle = '#eeeeee';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.save();

    ctx.rotate(start + slice / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 25px sans-serif';

    const rawLabel =
      names.get(id) || `لاعب ${id.slice(-4)}`;

    const label =
      rawLabel.length > 15
        ? rawLabel.slice(0, 13) + '…'
        : rawLabel;

    ctx.fillText(label, radius - 24, 9);

    ctx.restore();
  });

  ctx.beginPath();
  ctx.arc(0, 0, 92, 0, Math.PI * 2);

  ctx.fillStyle = '#202020';
  ctx.fill();

  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 8;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('HERVIN', 0, 10);

  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(center - 24, 12);
  ctx.lineTo(center + 24, 12);
  ctx.lineTo(center, 78);
  ctx.closePath();

  ctx.fillStyle = '#d4af37';
  ctx.fill();

  return canvas.toBuffer('image/png');
}

// حركة العجلة

async function animateWheel(game, eliminatedId) {
  const msg = await game.panel.fetch();

  const players = [...game.players];
  const targetIndex = players.indexOf(eliminatedId);

  const slice = Math.PI * 2 / players.length;

  const targetRotation =
    -Math.PI / 2 -
    (targetIndex + 0.5) * slice +
    Math.PI * 2 * 5;

  const startRotation = Math.random() * Math.PI * 2;

  for (let frame = 0; frame <= 5; frame++) {
    const t = frame / 5;
    const eased = 1 - Math.pow(1 - t, 3);

    const rotation =
      startRotation +
      (targetRotation - startRotation) * eased;

    const file = new AttachmentBuilder(
      drawWheel(players, rotation, game.names || new Map()),
      { name: 'hervin-wheel.png' }
    );

    await msg.edit({
      embeds: [
        baseEmbed(
          '🎰 HERVIN ROULETTE',
          `🎡 العجلة تدور...\n👥 المتبقون: **${players.length}**`
        )
      ],
      files: [file],
      attachments: [],
      components: []
    }).catch(() => {});

    await sleep(1150);
  }
}

// بدء الروليت

async function startRoulette(game) {
  if (game.started || game.players.length < 2) return;

  game.started = true;
  game.registrationClosed = true;

  clearInterval(game.timer);

  const channel = game.channel;

  await game.panel.edit({
    embeds: [
      baseEmbed(
        '🎰 HERVIN ROULETTE',
        'بدأت الجولة، استعدوا للعجلة!'
      )
    ],
    components: []
  }).catch(() => {});

  while (game.players.length > 1) {
    const eliminated = randomItem(game.players);

    await animateWheel(game, eliminated);

    game.players = game.players.filter(
      id => id !== eliminated
    );

    await channel.send({
      embeds: [
        baseEmbed(
          '🎡 نتيجة الروليت',
          `**تم اختيار اللاعب:**\n\n` +
          `${mention(eliminated)}\n\n` +
          `❌ تم استبعاده\n` +
          `👥 المتبقون: **${game.players.length}**`
        )
      ]
    });

    await sleep(2200);
  }

  await channel.send({
    embeds: [
      baseEmbed(
        '🏆 الفائز في الروليت',
        `👑 الفائز هو ${mention(game.players[0])}`,
        '#D4AF37'
      )
    ]
  });

  games.delete(game.channelId);
}

// ================================
// MAFIA
// ================================

function mafiaRoleCounts(n) {
  const mafia = Math.max(1, Math.floor(n / 4));

  const roles = Array(mafia).fill('mafia');

  if (n >= 5) roles.push('doctor');
  if (n >= 6) roles.push('detective');

  while (roles.length < n) {
    roles.push('citizen');
  }

  return roles;
}

const roleNames = {
  mafia: '🔪 المافيا',
  doctor: '👨‍⚕️ الطبيب',
  detective: '🕵️ المحقق',
  citizen: '👨‍🌾 المواطن'
};

function mafiaLobbyEmbed(g) {
  const list = g.players.length
    ? g.players.map((id, i) => `**${i + 1}.** ${mention(id)}`).join('\n')
    : 'بانتظار دخول اللاعبين...';

  return baseEmbed(
    '🔪 HERVIN MAFIA',
    `**التسجيل في لعبة المافيا**\n\n` +
    `⏱️ الوقت المتبقي: **${g.timeLeft} ثانية**\n` +
    `👥 اللاعبين: **${g.players.length}/${MAX_PLAYERS}**\n\n` +
    list
  );
}

function mafiaLobbyControls(g) {
  return buttons(
    button(
      'mafia_join',
      'دخول اللعبة',
      '➕',
      ButtonStyle.Success,
      g.registrationClosed ||
      g.started ||
      g.players.length >= MAX_PLAYERS
    ),

    button(
      'mafia_start',
      'بدء اللعبة',
      '🔪',
      ButtonStyle.Primary,
      g.players.length < 4 || g.started
    ),

    button(
      'mafia_cancel',
      'إلغاء',
      '❌',
      ButtonStyle.Danger,
      g.started
    )
  );
}

function aliveOptions(g, excludeId = null) {
  return g.alive
    .filter(id => id !== excludeId)
    .slice(0, 25)
    .map(id => ({
      label: g.names.get(id) || `لاعب ${id.slice(-4)}`,
      value: id
    }));
}

async function sendMafiaStatus(g, text) {
  await g.channel.send({
    embeds: [
      baseEmbed('🔪 HERVIN MAFIA', text)
    ]
  });
}

function mafiaWin(g) {
  const mafiaAlive = g.alive.filter(
    id => g.roles.get(id) === 'mafia'
  ).length;

  const townAlive = g.alive.length - mafiaAlive;

  if (mafiaAlive === 0) return 'town';
  if (mafiaAlive >= townAlive) return 'mafia';

  return null;
}

async function endMafia(g, winner) {
  g.started = false;

  clearTimeout(g.phaseTimer);

  const lines = g.players.map(id =>
    `${mention(id)} — ${roleNames[g.roles.get(id)]}` +
    `${g.alive.includes(id) ? ' ✅' : ' ❌'}`
  ).join('\n');

  await g.channel.send({
    embeds: [
      baseEmbed(
        winner === 'mafia'
          ? '🔪 فوز المافيا'
          : '🏆 فوز المواطنين',

        `**انتهت اللعبة!**\n\n` +
        `${winner === 'mafia'
          ? 'سيطرت المافيا على المدينة'
          : 'تم القضاء على المافيا'}\n\n` +
        `**الأدوار:**\n${lines}`,

        '#D4AF37'
      )
    ]
  });

  games.delete(g.channelId);
}

// الليل

async function startNight(g) {
  if (!g.started) return;

  g.phase = 'night';

  g.actions = {
    kill: new Map(),
    protect: new Map(),
    inspect: new Map()
  };

  await sendMafiaStatus(
    g,
    `🌙 **حلّ الليل**\n` +
    `على المافيا والطبيب والمحقق اختيار أهدافهم من زر **إجراء الليل**\n` +
    `الوقت المتاح: 35 ثانية`
  );

  const row = buttons(
    button(
      'mafia_night_action',
      'إجراء الليل',
      '🌙',
      ButtonStyle.Primary
    )
  );

  await g.channel.send({
    content: 'الإجراءات الليلية سرية لكل لاعب',
    components: [row]
  });

  g.phaseTimer = setTimeout(
    () => resolveNight(g).catch(console.error),
    35000
  );
}

async function resolveNight(g) {
  if (!g.started || g.phase !== 'night') return;

  clearTimeout(g.phaseTimer);

  const killVotes = [...g.actions.kill.values()];

  const target = killVotes.length
    ? killVotes.sort(
        (a, b) =>
          killVotes.filter(x => x === b).length -
          killVotes.filter(x => x === a).length
      )[0]
    : null;

  const protectedId =
    [...g.actions.protect.values()][0] || null;

  if (
    target &&
    target !== protectedId &&
    g.alive.includes(target)
  ) {
    g.alive = g.alive.filter(id => id !== target);

    await sendMafiaStatus(
      g,
      `☀️ **طلع النهار**\n` +
      `تم العثور على ${mention(target)} مقتولًا خلال الليل`
    );
  } else {
    await sendMafiaStatus(
      g,
      '☀️ **طلع النهار**\nلم يمت أحد هذه الليلة'
    );
  }

  for (const [detectiveId, targetId] of g.actions.inspect) {
    const isMafia = g.roles.get(targetId) === 'mafia';

    g.inspections.set(detectiveId, {
      targetId,
      isMafia
    });
  }

  const winner = mafiaWin(g);

  if (winner) return endMafia(g, winner);

  await startDay(g);
}

// النهار والتصويت

async function startDay(g) {
  g.phase = 'day';
  g.votes = new Map();

  await sendMafiaStatus(
    g,
    `☀️ **مرحلة النقاش والتصويت**\n` +
    `اختاروا لاعبًا لإخراجه من المدينة\n` +
    `الوقت: 35 ثانية`
  );

  const row = buttons(
    button(
      'mafia_vote',
      'التصويت للإقصاء',
      '🗳️',
      ButtonStyle.Primary
    )
  );

  await g.channel.send({
    content: 'التصويت سري، وكل لاعب يصوّت مرة واحدة',
    components: [row]
  });

  g.phaseTimer = setTimeout(
    () => resolveDay(g).catch(console.error),
    35000
  );
}

async function resolveDay(g) {
  if (!g.started || g.phase !== 'day') return;

  clearTimeout(g.phaseTimer);

  const counts = new Map();

  for (const target of g.votes.values()) {
    counts.set(target, (counts.get(target) || 0) + 1);
  }

  const max = Math.max(0, ...counts.values());

  const leaders = [...counts]
    .filter(([, count]) => count === max && max > 0)
    .map(([id]) => id);

  if (leaders.length === 1) {
    const out = leaders[0];

    g.alive = g.alive.filter(id => id !== out);

    await sendMafiaStatus(
      g,
      `⚖️ تم إخراج ${mention(out)} من اللعبة\n` +
      `دوره: **${roleNames[g.roles.get(out)]}**`
    );
  } else {
    await sendMafiaStatus(
      g,
      '⚖️ انتهى التصويت بالتعادل، لم يتم إخراج أحد'
    );
  }

  const winner = mafiaWin(g);

  if (winner) return endMafia(g, winner);

  await startNight(g);
}

// بدء المافيا

async function startMafia(g) {
  if (g.started || g.players.length < 4) return;

  g.started = true;
  g.registrationClosed = true;

  clearInterval(g.timer);

  g.alive = [...g.players];
  g.names = new Map();
  g.roles = new Map();
  g.inspections = new Map();

  for (const id of g.players) {
    try {
      const member = await g.guild.members.fetch(id);
      g.names.set(id, member.displayName);
    } catch {
      g.names.set(id, `لاعب ${id.slice(-4)}`);
    }
  }

  const roles = mafiaRoleCounts(g.players.length)
    .sort(() => Math.random() - 0.5);

  g.players.forEach((id, i) => {
    g.roles.set(id, roles[i]);
  });

  await g.panel.edit({
    embeds: [
      baseEmbed(
        '🔪 HERVIN MAFIA',
        'بدأت اللعبة! اضغط زر **اعرف دوري** لعرض دورك برسالة مخفية لا يراها غيرك.'
      )
    ],
    components: [
      buttons(
        button(
          'mafia_reveal',
          'اعرف دوري',
          '👁️',
          ButtonStyle.Secondary
        )
      )
    ]
  }).catch(() => {});

  await sendMafiaStatus(
    g,
    `تم توزيع الأدوار سرًا على **${g.players.length}** لاعبين\n` +
    `المافيا: **${roles.filter(r => r === 'mafia').length}**`
  );

  await startNight(g);
}

// ================================
// COMMANDS
// ================================

client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;

  const command = message.content.trim();

  if (command !== 'روليت' && command !== 'مافيا') return;

  if (games.has(message.channel.id)) {
    return message.reply(
      '⚠️ توجد لعبة قائمة بالفعل في هذا الروم'
    );
  }

  if (command === 'روليت') {
    const g = {
      type: 'roulette',
      channelId: message.channel.id,
      channel: message.channel,
      names: new Map(),
      players: [],
      timeLeft: REGISTER_SECONDS,
      registrationClosed: false,
      started: false,
      panel: null,
      timer: null
    };

    const panel = await message.channel.send({
      embeds: [roulettePanel(g)],
      components: [rouletteControls(g)]
    });

    g.panel = panel;
    games.set(g.channelId, g);

    g.timer = setInterval(async () => {
      if (g.registrationClosed || g.started) return;

      g.timeLeft--;

      if (g.timeLeft <= 0) {
        clearInterval(g.timer);
        g.registrationClosed = true;

        await panel.edit({
          embeds: [
            baseEmbed(
              '🎰 انتهى التسجيل',
              `👥 عدد اللاعبين: **${g.players.length}**\n\n` +
              `${g.players.length >= 2
                ? 'يمكن للإداري بدء اللعبة الآن'
                : 'نحتاج لاعبين اثنين على الأقل'}`
            )
          ],
          components: [
            buttons(
              button(
                'roulette_start',
                'بدء اللعبة',
                '🎰',
                ButtonStyle.Primary,
                g.players.length < 2
              ),
              button(
                'roulette_cancel',
                'إلغاء',
                '❌',
                ButtonStyle.Danger
              )
            )
          ]
        }).catch(() => {});
      } else if (g.timeLeft % 5 === 0) {
        await panel.edit({
          embeds: [roulettePanel(g)],
          components: [rouletteControls(g)]
        }).catch(() => {});
      }
    }, 1000);

  } else {
    const g = {
      type: 'mafia',
      channelId: message.channel.id,
      channel: message.channel,
      guild: message.guild,
      players: [],
      timeLeft: REGISTER_SECONDS,
      registrationClosed: false,
      started: false,
      panel: null,
      timer: null
    };

    const panel = await message.channel.send({
      embeds: [mafiaLobbyEmbed(g)],
      components: [mafiaLobbyControls(g)]
    });

    g.panel = panel;
    games.set(g.channelId, g);

    g.timer = setInterval(async () => {
      if (g.registrationClosed || g.started) return;

      g.timeLeft--;

      if (g.timeLeft <= 0) {
        clearInterval(g.timer);
        g.registrationClosed = true;

        await panel.edit({
          embeds: [
            baseEmbed(
              '🔪 انتهى التسجيل',
              `👥 عدد اللاعبين: **${g.players.length}**\n\n` +
              `${g.players.length >= 4
                ? 'يمكن للإداري بدء اللعبة الآن'
                : 'المافيا تحتاج 4 لاعبين على الأقل'}`
            )
          ],
          components: [
            buttons(
              button(
                'mafia_start',
                'بدء اللعبة',
                '🔪',
                ButtonStyle.Primary,
                g.players.length < 4
              ),
              button(
                'mafia_cancel',
                'إلغاء',
                '❌',
                ButtonStyle.Danger
              )
            )
          ]
        }).catch(() => {});
      } else if (g.timeLeft % 5 === 0) {
        await panel.edit({
          embeds: [mafiaLobbyEmbed(g)],
          components: [mafiaLobbyControls(g)]
        }).catch(() => {});
      }
    }, 1000);
  }
});

// ================================
// INTERACTIONS
// ================================

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (
      !interaction.isButton() &&
      !interaction.isStringSelectMenu()
    ) return;

    const g = games.get(interaction.channelId);

    if (!g) {
      return interaction.reply({
        content: 'انتهت اللعبة أو لم تعد موجودة',
        ephemeral: true
      }).catch(() => {});
    }

    const id = interaction.customId;

    // دخول اللعبة

    if (id.endsWith('_join')) {
      if (g.registrationClosed || g.started) {
        return interaction.reply({
          content: '❌ التسجيل مغلق',
          ephemeral: true
        });
      }

      if (g.players.includes(interaction.user.id)) {
        return interaction.reply({
          content: 'أنت مسجل بالفعل',
          ephemeral: true
        });
      }

      if (g.players.length >= MAX_PLAYERS) {
        return interaction.reply({
          content: 'اكتمل الحد الأقصى: 20 لاعب',
          ephemeral: true
        });
      }

      g.players.push(interaction.user.id);

      const displayName =
        interaction.member?.displayName ||
        interaction.member?.nick ||
        interaction.user.globalName ||
        interaction.user.username;

      g.names?.set(interaction.user.id, displayName);

      return interaction.update({
        embeds: [
          g.type === 'roulette'
            ? roulettePanel(g)
            : mafiaLobbyEmbed(g)
        ],
        components: [
          g.type === 'roulette'
            ? rouletteControls(g)
            : mafiaLobbyControls(g)
        ]
      });
    }

    // بدء اللعبة

    if (id.endsWith('_start')) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: '❌ بدء اللعبة للإداريين فقط',
          ephemeral: true
        });
      }

      if (
        g.type === 'roulette' &&
        g.players.length < 2
      ) {
        return interaction.reply({
          content: 'تحتاج لاعبين اثنين على الأقل',
          ephemeral: true
        });
      }

      if (
        g.type === 'mafia' &&
        g.players.length < 4
      ) {
        return interaction.reply({
          content: 'تحتاج 4 لاعبين على الأقل',
          ephemeral: true
        });
      }

      await interaction.deferUpdate();

      return g.type === 'roulette'
        ? startRoulette(g)
        : startMafia(g);
    }

    // إلغاء اللعبة

    if (id.endsWith('_cancel')) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: '❌ الإلغاء للإداريين فقط',
          ephemeral: true
        });
      }

      clearInterval(g.timer);
      clearTimeout(g.phaseTimer);

      games.delete(g.channelId);

      return interaction.update({
        embeds: [
          baseEmbed(
            '❌ تم إلغاء اللعبة',
            'ألغى الإداري اللعبة'
          )
        ],
        components: []
      });
    }

    // معرفة الدور السري

    if (id === 'mafia_reveal') {
      if (
        !g.started ||
        !g.roles?.has(interaction.user.id)
      ) {
        return interaction.reply({
          content: 'أنت لست ضمن هذه اللعبة',
          ephemeral: true
        });
      }

      const role = g.roles.get(interaction.user.id);

      const extra =
        role === 'mafia'
          ? `\nزملاؤك: ${
              g.players
                .filter(
                  p =>
                    g.roles.get(p) === 'mafia' &&
                    p !== interaction.user.id
                )
                .map(mention)
                .join('، ') || 'أنت وحدك'
            }`
          : '';

      return interaction.reply({
        content: `دورك السري هو: **${roleNames[role]}**${extra}`,
        ephemeral: true
      });
    }

    // إجراء الليل

    if (id === 'mafia_night_action') {
      if (
        !g.started ||
        g.phase !== 'night' ||
        !g.alive.includes(interaction.user.id)
      ) {
        return interaction.reply({
          content: 'لا يوجد إجراء متاح لك الآن',
          ephemeral: true
        });
      }

      const role = g.roles.get(interaction.user.id);

      const kind =
        role === 'mafia'
          ? 'kill'
          : role === 'doctor'
            ? 'protect'
            : role === 'detective'
              ? 'inspect'
              : null;

      if (!kind) {
        return interaction.reply({
          content: 'ليس لديك إجراء ليلي',
          ephemeral: true
        });
      }

      const options = aliveOptions(
        g,
        kind === 'kill'
          ? interaction.user.id
          : null
      );

      if (!options.length) {
        return interaction.reply({
          content: 'لا يوجد لاعبون متاحون',
          ephemeral: true
        });
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`night_${kind}`)
        .setPlaceholder('اختر لاعبًا')
        .addOptions(options);

      return interaction.reply({
        content: 'اختر هدفك بسرية:',
        components: [
          new ActionRowBuilder().addComponents(menu)
        ],
        ephemeral: true
      });
    }

    // التصويت النهاري

    if (id === 'mafia_vote') {
      if (
        !g.started ||
        g.phase !== 'day' ||
        !g.alive.includes(interaction.user.id)
      ) {
        return interaction.reply({
          content: 'التصويت غير متاح لك الآن',
          ephemeral: true
        });
      }

      if (g.votes.has(interaction.user.id)) {
        return interaction.reply({
          content: 'لقد صوّت بالفعل',
          ephemeral: true
        });
      }

      const options = aliveOptions(
        g,
        interaction.user.id
      );

      if (!options.length) {
        return interaction.reply({
          content: 'لا يوجد لاعبون للتصويت عليهم',
          ephemeral: true
        });
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('mafia_day_vote')
        .setPlaceholder('اختر اللاعب المراد إخراجه')
        .addOptions(options);

      return interaction.reply({
        content: 'صوّت بسرية:',
        components: [
          new ActionRowBuilder().addComponents(menu)
        ],
        ephemeral: true
      });
    }

    // القوائم السرية

    if (interaction.isStringSelectMenu()) {
      const target = interaction.values[0];

      if (id.startsWith('night_')) {
        const kind = id.slice(6);
        const role = g.roles.get(interaction.user.id);

        if (
          !g.started ||
          g.phase !== 'night' ||
          !g.alive.includes(interaction.user.id)
        ) {
          return interaction.reply({
            content: 'انتهى وقت الإجراء',
            ephemeral: true
          });
        }

        const expected = {
          kill: 'mafia',
          protect: 'doctor',
          inspect: 'detective'
        }[kind];

        if (role !== expected) {
          return interaction.reply({
            content: 'هذا الإجراء ليس لدورك',
            ephemeral: true
          });
        }

        if (
          kind === 'kill' &&
          g.roles.get(target) === 'mafia'
        ) {
          return interaction.reply({
            content: 'لا يمكنك اختيار فرد من المافيا',
            ephemeral: true
          });
        }

        g.actions[kind].set(
          interaction.user.id,
          target
        );

        if (kind === 'inspect') {
          const result =
            g.roles.get(target) === 'mafia'
              ? 'ينتمي إلى المافيا 🔪'
              : 'ليس من المافيا ✅';

          return interaction.update({
            content:
              `نتيجة التحقيق السرية: ${mention(target)} ${result}`,
            components: []
          });
        }

        return interaction.update({
          content:
            kind === 'protect'
              ? 'تم تسجيل الحماية بسرية 👨‍⚕️'
              : 'تم تسجيل اختيار المافيا بسرية 🔪',
          components: []
        });
      }

      if (id === 'mafia_day_vote') {
        if (
          !g.started ||
          g.phase !== 'day' ||
          !g.alive.includes(interaction.user.id)
        ) {
          return interaction.reply({
            content: 'انتهى التصويت',
            ephemeral: true
          });
        }

        if (g.votes.has(interaction.user.id)) {
          return interaction.reply({
            content: 'لقد صوّت بالفعل',
            ephemeral: true
          });
        }

        g.votes.set(interaction.user.id, target);

        return interaction.update({
          content:
            `تم تسجيل تصويتك لـ ${mention(target)} بسرية`,
          components: []
        });
      }
    }

  } catch (error) {
    console.error('Interaction error:', error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'حدث خطأ أثناء تنفيذ طلبك، حاول مرة أخرى',
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// ================================
// BOT READY
// ================================

client.once(Events.ClientReady, () => {
  console.log(
    `HERVIN GAMES ONLINE: ${client.user.tag}`
  );
});

client.on('error', error => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled rejection:', error);
});

// التحقق من التوكن

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
