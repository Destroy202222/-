// Supabase Edge Function: read-scoreboard
// Читает скриншот таблицы результатов Standoff 2 и возвращает JSON. Доступна только админам.
const PROMPT = `Ты читаешь скриншот таблицы статистики матча Standoff 2 (на русском или английском).
Верни ТОЛЬКО JSON без пояснений и без markdown по схеме:
{
  "map": "название карты или null",
  "sides": [
    {
      "header": "заголовок стороны как написан (Оборона/Атака/Defense/Attack...)",
      "round_score": число (крупный счёт раундов у заголовка стороны) или null,
      "is_winner": true если рядом именно с этой стороной написано ПОБЕДА/VICTORY, иначе false,
      "players": [
        {"name": "ник игрока БЕЗ клановой приставки в квадратных скобках, буква в букву как на экране; если ник обрезан многоточием — оставь многоточие",
         "kills": число или null, "assists": число или null, "deaths": число или null, "score": число из колонки Счёт или null}
      ]
    }
  ]
}
Правила:
- Колонки слева направо: # , Имя, [Деньги — бывает не у всех], У (убийства), П (помощь), С (смерти), Счёт, Пинг. Деньги ($) и пинг игнорируй, они не относятся к K/D/A.
- Не предполагай, какая сторона слева или справа: каждая таблица — отдельная сторона, читай как есть.
- Клановый тег в [квадратных скобках] в name НЕ включай.
- Не выдумывай игроков и числа. Нечитаемое значение — null.
- Звёзды, флаги, иконки и аватары игнорируй.`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const { image, match_id } = await req.json();
    if (!image || !match_id) return json({ error: 'bad request' }, 400);

    // Проверка прав: RPC admin_match_shots доступен только админам (сессия идёт в X-Client-Info, как в приложении)
    const gate = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/admin_match_shots`, {
      method: 'POST',
      headers: {
        apikey: Deno.env.get('SUPABASE_ANON_KEY')!,
        Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        'X-Client-Info': req.headers.get('x-client-info') ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_match: String(match_id) }),
    });
    if (!gate.ok) return json({ error: 'forbidden' }, 403);

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: 'model error', detail: JSON.stringify(data).slice(0, 300) }, 502);

    const text = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    return json(JSON.parse(text.slice(a, b + 1)));
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
