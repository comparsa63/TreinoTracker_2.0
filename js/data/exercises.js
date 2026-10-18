/**
 * Catálogo centralizado de exercícios — TreinoTracker v2.1.1
 *
 * Grupos premium (A, B, C): dados completos com metadados.
 * Grupos legados (D–I): formato compatível com campos novos como null.
 *
 * Campos por exercício:
 *   id, pt, en, nome (alias pt), group, grupoMuscular (alias group),
 *   subgrupo (opcional: grupo específico, ex.: "Quadríceps", "Posterior de Coxa",
 *   "Panturrilha", "Lombar", "Glúteo"), muscles[], secondary[], gif, video,
 *   difficulty, equipment, equipamento (alias equipment), tipo,
 *   instructions[], mistakes[], tips[]
 */
const ExerciseCatalog = {

    gruposMusculares: [
        { nome: "Bíceps", exercicios: [] },
        { nome: "Tríceps", exercicios: [] },
        { nome: "Peito", exercicios: [] },
        { nome: "Costas", exercicios: [] },
        { nome: "Ombro", exercicios: [] },
        { nome: "Trapézio", exercicios: [] },
        { nome: "Pernas", exercicios: [] },
        { nome: "Glúteo", exercicios: [] },
        { nome: "Abdômen", exercicios: [] },
        { nome: "Antebraço", exercicios: [] },
        { nome: "Lombar", exercicios: [] },
        { nome: "Manguito Rotador", exercicios: [] },
        { nome: "Mobilidade", exercicios: [] }
    ],

    exercicios: [

        // ─────────────────────────────────────────────────────────────
        //  GRUPO A — BÍCEPS (Premium)
        // ─────────────────────────────────────────────────────────────

        {
            id: "A-01", pt: "Rosca direta barra", en: "Barbell Curl",
            nome: "Rosca direta barra", group: "Bíceps", grupoMuscular: "Bíceps",
            muscles: ["Bíceps longo", "Bíceps curto"], secondary: ["Braquial", "Braciorradial"],
            gif: "assets/gifs/biceps/rosca-direta-barra.gif",
            video: "https://www.youtube.com/results?search_query=barbell+curl+leandro+twin",
            difficulty: "Intermediate", equipment: "Barra reta", equipamento: "Barra reta", tipo: "A",
            instructions: [
                "Segure a barra com pegada supinada, mãos na largura dos ombros.",
                "Com os cotovelos colados ao corpo, flexione os cotovelos subindo a barra.",
                "Contraia o bíceps no topo do movimento por 1 segundo.",
                "Desça a barra de forma controlada até a extensão completa dos braços.",
                "Mantenha o tronco estável durante todo o movimento."
            ],
            mistakes: [
                "Balancar o tronco para gerar impulso.",
                "Subir a barra rápido demais sem contração.",
                "Não descer até a extensão completa."
            ],
            tips: [
                "Use uma barra reta para maior ativação do bíceps longo.",
                "Para proteger os pulsos, use uma barra W (EZ).",
                "Foque na contração excêntrica (descida lenta de 3 segundos)."
            ]
        },

        {
            id: "A-02", pt: "Rosca direta halteres", en: "Dumbbell Curl",
            nome: "Rosca direta halteres", group: "Bíceps", grupoMuscular: "Bíceps",
            muscles: ["Bíceps longo", "Bíceps curto"], secondary: ["Braquial", "Antebraço"],
            gif: "assets/gifs/biceps/rosca-direta-halteres.gif",
            video: "https://www.youtube.com/results?search_query=dumbbell+curl+leandro+twin",
            difficulty: "Beginner", equipment: "Halteres", equipamento: "Halteres", tipo: "A",
            instructions: [
                "Segure um halter em cada mão com braços estendidos ao lado do corpo.",
                "Alterne a flexão dos cotovelos, subindo um halter por vez.",
                "Gire o pulso (supinação) conforme sobe para maior contração.",
                "Desça de forma controlada antes de alternar o outro braço.",
                "Mantenha os cotovelos fixos ao lado do tronco."
            ],
            mistakes: [
                "Usar impulso do corpo para levantar o peso.",
                "Deixar os cotovelos saírem para frente.",
                "Fazer o movimento rápido demais."
            ],
            tips: [
                "Sentado, evita compensação com o tronco.",
                "Alterne os braços para focar em cada um individualmente.",
                "Suba com supinação e desça neutro para maximizar ativação."
            ]
        },

        {
            id: "A-03", pt: "Rosca 21 barra W", en: "EZ Bar 21s",
            nome: "Rosca 21 barra W", group: "Bíceps", grupoMuscular: "Bíceps",
            muscles: ["Bíceps longo", "Bíceps curto"], secondary: ["Braquial"],
            gif: "assets/gifs/biceps/rosca-21-barra-w.gif",
            video: "https://www.youtube.com/results?search_query=barbell+21+biceps+leandro+twin",
            difficulty: "Intermediate", equipment: "Barra W", equipamento: "Barra W", tipo: "A",
            instructions: [
                "Segure a barra W com pegada supinada, mãos na largura dos ombros.",
                "Faça 7 repetições apenas na metade inferior do movimento.",
                "Faça 7 repetições apenas na metade superior do movimento.",
                "Faça 7 repetições completas (amplitude total).",
                "Não descance entre as fases — execute as 21 seguidas."
            ],
            mistakes: [
                "Fazer todas as 21 com amplitude parcial.",
                "Descansar entre as fases.",
                "Usar peso excessivo que comprometa a forma."
            ],
            tips: [
                "Use 50-60% do peso que faria numa rosca normal.",
                "Mantenha a contração constante — não travo no fundo.",
                "Excelente exercício de finalização (finisher)."
            ]
        },

        {
            id: "A-04", pt: "Rosca inclinada", en: "Incline Dumbbell Curl",
            nome: "Rosca inclinada", group: "Bíceps", grupoMuscular: "Bíceps",
            muscles: ["Bíceps longo"], secondary: ["Bíceps curto", "Braquial"],
            gif: "assets/gifs/biceps/rosca-inclinada.gif",
            video: "https://www.youtube.com/results?search_query=incline+dumbbell+curl+leandro+twin",
            difficulty: "Intermediate", equipment: "Halteres e banco inclinado", equipamento: "Halteres e banco inclinado", tipo: "A",
            instructions: [
                "Ajuste o banco entre 45° e 60° de inclinação.",
                "Sente-se com as costas apoiadas e segure um halter em cada mão.",
                "Deixe os braços caírem perpendicularmente ao chão.",
                "Flexione os cotovelos subindo os halteres sem mover os braços.",
                "Desça até a extensão completa, sentindo o estiramento no bíceps."
            ],
            mistakes: [
                "Usar inclinação muito alta (braços ficam para trás).",
                "Levantar os cotovelos ao subir.",
                "Fazer momentum com o tronco."
            ],
            tips: [
                "A inclinação de 60° maximiza o alongamento do bíceps longo.",
                "Use peso menor que na rosca direta — o exercício é mais difícil.",
                "Segure 2 segundos na fase excêntrica para maior hipertrofia."
            ]
        },

        {
            id: "A-05", pt: "Rosca martelo", en: "Hammer Curl",
            nome: "Rosca martelo", group: "Bíceps", grupoMuscular: "Bíceps",
            muscles: ["Braquial", "Braquiorradial"], secondary: ["Bíceps longo"],
            gif: "assets/gifs/biceps/rosca-martelo.gif",
            video: "https://www.youtube.com/results?search_query=hammer+curl+leandro+twin",
            difficulty: "Beginner", equipment: "Halteres", equipamento: "Halteres", tipo: "A",
            instructions: [
                "Segure um halter em cada mão com pegada neutra (palmas viradas).",
                "Flexione os cotovelos subindo os halteres sem girar o pulso.",
                "Mantenha a pegada neutra durante todo o movimento.",
                "Contraia no topo por 1 segundo e desça controlado.",
                "Pode ser feito alternado ou simultâneo."
            ],
            mistakes: [
                "Girar o pulso para supinação no topo.",
                "Balancar o corpo para gerar impulso.",
                "Usar halteres pesados demais."
            ],
            tips: [
                "Foco no braquial — dá espessura ao braço quando visto de lado.",
                "Alterne os braços para maior concentração.",
                "Variação: martelo no banco scott para isolar mais."
            ]
        },

        {
            id: "A-06", pt: "Rosca concentrada", en: "Concentration Curl",
            nome: "Rosca concentrada", group: "Bíceps", grupoMuscular: "Bíceps",
            muscles: ["Bíceps curto"], secondary: ["Bíceps longo"],
            gif: "assets/gifs/biceps/rosca-concentrada.gif",
            video: "https://www.youtube.com/results?search_query=concentration+curl+leandro+twin",
            difficulty: "Beginner", equipment: "Halter", equipamento: "Halter", tipo: "A",
            instructions: [
                "Sente-se na bancada e segure um halter com a mão direita.",
                "Encoste a parte interna do cotovelo na coxa interna.",
                "Flexione o cotovelo subindo o halter até a contração máxima.",
                "Segure 1-2 segundos no topo e desça lentamente.",
                "Repetir com o braço esquerdo."
            ],
            mistakes: [
                "Mover o cotovelo da posição fixa.",
                "Fazer o movimento rápido sem contração.",
                "Inclinar o tronco para o lado."
            ],
            tips: [
                "Excelente para criar o pico do bíceps (contraction peak).",
                "Use peso moderado — o foco é na qualidade da contração.",
                "Olhe para o bíceps durante o movimento para增强 a conexão mente-músculo."
            ]
        },

        {
            id: "A-07", pt: "Rosca scott", en: "Preacher Curl",
            nome: "Rosca scott", group: "Bíceps", grupoMuscular: "Bíceps",
            muscles: ["Bíceps curto", "Bíceps longo"], secondary: ["Braquial"],
            gif: "assets/gifs/biceps/rosca-scott.gif",
            video: "https://www.youtube.com/results?search_query=preacher+curl+leandro+twin",
            difficulty: "Intermediate", equipment: "Barra W e banco scott", equipamento: "Barra W e banco scott", tipo: "A",
            instructions: [
                "Ajuste o banco scott para que as axilas fiquem apoiadas na borda.",
                "Segure a barra W com pegada supinada.",
                "Desça a barra até a extensão quase completa dos braços.",
                "Suba a barra contraindo o bíceps, sem levantar os cotovelos.",
                "Controle a descida por 3 segundos."
            ],
            mistakes: [
                "Deixar os cotovelos saírem da almofada.",
                "Travar os cotovelos em extensão completa (risco de lesão).",
                "Usar peso excessivo e balançar."
            ],
            tips: [
                "Isola o bíceps — elimina toda compensação.",
                "Não trave o cotovelo embaixo: pare 10° antes da extensão total.",
                "Use halter unilateral para corrigir desequilíbrios."
            ]
        },

        {
            id: "A-08", pt: "Rosca cabo polia baixa", en: "Cable Curl",
            nome: "Rosca cabo polia baixa", group: "Bíceps", grupoMuscular: "Bíceps",
            muscles: ["Bíceps longo", "Bíceps curto"], secondary: ["Braquial"],
            gif: "assets/gifs/biceps/rosca-cabo-polia-baixa.gif",
            video: "https://www.youtube.com/results?search_query=cable+curl+leandro+twin",
            difficulty: "Beginner", equipment: "Polia baixa", equipamento: "Polia baixa", tipo: "A",
            instructions: [
                "Fique de pé diante da polia baixa, segurando a barra reta ou W.",
                "Com os cotovelos fixos ao lado do corpo, flexione subindo a barra.",
                "Contraia o bíceps no topo por 1-2 segundos.",
                "Desça de forma controlada mantendo tensão constante.",
                "Mantenha os pés na largura dos ombros para estabilidade."
            ],
            mistakes: [
                "Mover os cotovelos para frente ou para trás.",
                "Deixar a polia puxar os braços para baixo rápido demais.",
                "Inclinar o tronco para trás."
            ],
            tips: [
                "A tensão constante do cabo maximiza o tempo sob tensão (TUT).",
                "Variações: barra reta, barra W, corda (para martelo), pegada fechada.",
                "Excelente para drop sets rápidos — apenas troque a carga na polia."
            ]
        },

        {
            id: "A-09", pt: "Rosca inversa", en: "Reverse Curl",
            nome: "Rosca inversa", group: "Bíceps", grupoMuscular: "Bíceps",
            muscles: ["Braciorradial", "Braquial"], secondary: ["Bíceps longo", "Bíceps curto"],
            gif: "assets/gifs/biceps/rosca-inversa.gif",
            video: "https://www.youtube.com/results?search_query=reverse+curl+leandro+twin",
            difficulty: "Intermediate", equipment: "Barra reta ou W", equipamento: "Barra reta ou W", tipo: "A",
            instructions: [
                "Segure a barra com pegada pronada (palmas viradas para baixo).",
                "Mãos na largura dos ombros, cotovelos colados ao corpo.",
                "Flexione os cotovelos subindo a barra até a altura dos ombros.",
                "Segure 1 segundo no topo e desça controlado.",
                "Mantenha os punhos firmes durante todo o movimento."
            ],
            mistakes: [
                "Usar barra muito pesada (compromete os punhos).",
                "Mover os cotovelos para cima.",
                "Não controlar a descida."
            ],
            tips: [
                "Fortalece antebraço e braquiorradial — essencial para pegada em outros exercícios.",
                "Barra W é mais confortável para os pulsos que a barra reta.",
                "Combine com rosca martelo para desenvolvimento completo do braço."
            ]
        },

        // ─────────────────────────────────────────────────────────────
        //  GRUPO B — TRÍCEPS (Premium)
        // ─────────────────────────────────────────────────────────────

        {
            id: "B-01", pt: "Tríceps polia", en: "Cable Tricep Pushdown",
            nome: "Tríceps polia", group: "Tríceps", grupoMuscular: "Tríceps",
            muscles: ["Tríceps lateral", "Tríceps longo"], secondary: ["Tríceps medial"],
            gif: "assets/gifs/triceps/triceps-polia.gif",
            video: "https://www.youtube.com/results?search_query=cable+pushdown+leandro+twin",
            difficulty: "Beginner", equipment: "Polia alta", equipamento: "Polia alta", tipo: "B",
            instructions: [
                "Fique de pé diante da polia alta, segurando a barra reta ou W.",
                "Mantenha os cotovelos fixos ao lado do corpo.",
                "Empurre a barra para baixo até a extensão completa dos braços.",
                "Contraia o tríceps no fundo por 1-2 segundos.",
                "Retorne controlado até 90° de flexão nos cotovelos."
            ],
            mistakes: [
                "Inclinar o tronco para frente e usar peso do corpo.",
                "Mover os cotovelos para frente.",
                "Não fazer a extensão completa."
            ],
            tips: [
                "Cotovelos fixos = isolamento perfeito do tríceps.",
                "Barra reta foca mais no lateral; corda foca no longo.",
                "Aproxime os cotovelos no fundo para máxima contração."
            ]
        },

        {
            id: "B-02", pt: "Tríceps pushdown", en: "Tricep Pushdown (V-Bar)",
            nome: "Tríceps pushdown", group: "Tríceps", grupoMuscular: "Tríceps",
            muscles: ["Tríceps lateral", "Tríceps medial"], secondary: ["Tríceps longo"],
            gif: "assets/gifs/triceps/triceps-pushdown.gif",
            video: "https://www.youtube.com/results?search_query=tricep+pushdown+v+bar+leandro+twin",
            difficulty: "Beginner", equipment: "Polia alta com barra V", equipamento: "Polia alta com barra V", tipo: "B",
            instructions: [
                "Segure a barra V com pegada neutra (palmas facing each other).",
                "Cotovelos colados ao corpo, costas retas.",
                "Empurre para baixo até extensão total dos braços.",
                "Segure a contração no fundo por 1 segundo.",
                "Volte lentamente até os antebraços ficarem paralelos ao chão."
            ],
            mistakes: [
                "Usar o corpo todo para empurrar.",
                "Soltar os cotovelos dos lados.",
                "Fazer movimento parcial."
            ],
            tips: [
                "A barra V permite pegada neutra — mais confortável para pulsos.",
                "Variação: troque a barra V por uma barra reta para pegada pronada.",
                "Mantenha os ombros para baixo e para trás durante o exercício."
            ]
        },

        {
            id: "B-03", pt: "Tríceps overhead", en: "Overhead Tricep Extension",
            nome: "Tríceps overhead", group: "Tríceps", grupoMuscular: "Tríceps",
            muscles: ["Tríceps longo"], secondary: ["Tríceps lateral", "Tríceps medial"],
            gif: "assets/gifs/triceps/triceps-overhead.gif",
            video: "https://www.youtube.com/results?search_query=overhead+tricep+extension+leandro+twin",
            difficulty: "Intermediate", equipment: "Cabo com corda", equipamento: "Cabo com corda", tipo: "B",
            instructions: [
                "De costas para a polia alta, segure a corda com as mãos acima da cabeça.",
                "Mantenha os cotovelos próximos à cabeça e apontando para frente.",
                "Estenda os cotovelos empurrando a corda para cima e para frente.",
                "Contraia o tríceps no topo por 1-2 segundos.",
                "Retorne controlado até sentir o alongamento no tríceps longo."
            ],
            mistakes: [
                "Abrir os cotovelos para os lados.",
                "Usar momentum do tronco.",
                "Não fazer a extensão completa."
            ],
            tips: [
                "Este exercício foca no tríceps longo — o único que cruza o ombro.",
                "Posição overhead = maior alongamento = maior estímulo para hipertrofia.",
                "Alternativa: halter com duas mãos, sentado no banco."
            ]
        },

        {
            id: "B-04", pt: "Tríceps testa", en: "Skull Crusher",
            nome: "Tríceps testa", group: "Tríceps", grupoMuscular: "Tríceps",
            muscles: ["Tríceps longo", "Tríceps lateral"], secondary: ["Tríceps medial"],
            gif: "assets/gifs/triceps/triceps-testa.gif",
            video: "https://www.youtube.com/results?search_query=skull+crusher+leandro+twin",
            difficulty: "Intermediate", equipment: "Barra W", equipamento: "Barra W", tipo: "B",
            instructions: [
                "Deite-se na bancada com os pés apoiados no chão.",
                "Segure a barra W com pegada pronada, braços estendidos acima do peito.",
                "Flexione os cotovelos descendo a barra até a testa (ou testa alta).",
                "Estenda os cotovelos voltando à posição inicial.",
                "Mantenha os cotovelos apontando para o teto durante todo o movimento."
            ],
            mistakes: [
                "Mover os cotovelos para frente (virar supino).",
                "Bater a barra na testa.",
                "Fazer o movimento rápido."
            ],
            tips: [
                "Cotovelos levemente apontando para trás (15-20°) para maior tensão.",
                "Se machucar os pulsos, use barra EZ/W em vez de reta.",
                "Progressão: descendo atrás da cabeça para maior alongamento."
            ]
        },

        {
            id: "B-05", pt: "Tríceps corda", en: "Rope Pushdown",
            nome: "Tríceps corda", group: "Tríceps", grupoMuscular: "Tríceps",
            muscles: ["Tríceps lateral", "Tríceps longo"], secondary: ["Tríceps medial"],
            gif: "assets/gifs/triceps/triceps-corda.gif",
            video: "https://www.youtube.com/results?search_query=rope+pushdown+leandro+twin",
            difficulty: "Beginner", equipment: "Polia alta com corda", equipamento: "Polia alta com corda", tipo: "B",
            instructions: [
                "Segure a corda com pegada neutra, mãos na altura dos ombros.",
                "Cotovelos fixos ao lado do corpo.",
                "Empurre a corda para baixo, separando as mãos no fundo.",
                "Contraia o tríceps com as mãos separadas por 1-2 segundos.",
                "Retorne controlado até as mãos ficarem na altura do peito."
            ],
            mistakes: [
                "Não separar as mãos no fundo (perde contração).",
                "Usar peso que comprometa a forma.",
                "Mover os cotovelos."
            ],
            tips: [
                "Separar as mãos no fundo ativa mais o tríceps lateral.",
                "Excelente para iniciantes — movimento natural e seguro.",
                "Fim ideal para treinos de tríceps (último exercício)."
            ]
        },

        {
            id: "B-06", pt: "Mergulho banco", en: "Bench Dip",
            nome: "Mergulho banco", group: "Tríceps", grupoMuscular: "Tríceps",
            muscles: ["Tríceps lateral", "Tríceps medial"], secondary: ["Tríceps longo", "Peito"],
            gif: "assets/gifs/triceps/mergulho-banco.gif",
            video: "https://www.youtube.com/results?search_query=bench+dip+leandro+twin",
            difficulty: "Beginner", equipment: "Banco", equipamento: "Banco", tipo: "B",
            instructions: [
                "Sente-se na borda de um banco, mãos ao lado do quadril com dedos apontando para frente.",
                "Deslize para frente e desça o corpo flexionando os cotovelos.",
                "Desça até os antebraços ficarem paralelos ao chão.",
                "Empurre o corpo para cima estendendo os cotovelos.",
                "Mantenha as costas próximas ao banco durante todo o movimento."
            ],
            mistakes: [
                "Mãos muito afastadas do banco.",
                "Descer demais (risco para o ombro).",
                "Inclinar o corpo muito para frente."
            ],
            tips: [
                "Adicione peso no colo para progressão.",
                "Para focar no tríceps: pernas estendidas. Para facilitar: joelhos flexionados.",
                "Evite este exercício se tiver dor no ombro."
            ]
        },

        {
            id: "B-07", pt: "Tríceps unilateral cabo", en: "Single-Arm Cable Pushdown",
            nome: "Tríceps unilateral cabo", group: "Tríceps", grupoMuscular: "Tríceps",
            muscles: ["Tríceps lateral"], secondary: ["Tríceps longo", "Tríceps medial"],
            gif: "assets/gifs/triceps/triceps-unilateral-cabo.gif",
            video: "https://www.youtube.com/results?search_query=single+arm+pushdown+leandro+twin",
            difficulty: "Intermediate", equipment: "Polia alta", equipamento: "Polia alta", tipo: "B",
            instructions: [
                "Fique de lado para a polia alta, segurando a pegada com uma mão.",
                "Cotovelo fixo ao lado do corpo, antebraço paralelo ao chão.",
                "Empurre a pegada para baixo até extensão completa.",
                "Contraia o tríceps no fundo por 1-2 segundos.",
                "Retorne controlado e repita. Troque de lado."
            ],
            mistakes: [
                "Girar o tronco durante o movimento.",
                "Mover o cotovelo.",
                "Fazer o movimento rápido."
            ],
            tips: [
                "Unilateral corrige desequilíbrios entre os braços.",
                "Foco intenso no tríceps lateral — ótimo para definição.",
                "Segure a contração por 2 segundos no fundo para maximizar ativação."
            ]
        },

        {
            id: "B-08", pt: "Supino fechado", en: "Close-Grip Bench Press",
            nome: "Supino fechado", group: "Tríceps", grupoMuscular: "Tríceps",
            muscles: ["Tríceps longo", "Tríceps lateral"], secondary: ["Peito", "Deltóide anterior"],
            gif: "assets/gifs/triceps/supino-fechado.gif",
            video: "https://www.youtube.com/results?search_query=close+grip+bench+press+leandro+twin",
            difficulty: "Intermediate", equipment: "Barra e banco reto", equipamento: "Barra e banco reto", tipo: "B",
            instructions: [
                "Deite-se no banco reto com os pés apoiados no chão.",
                "Segure a barra com pegada pronada, mãos na largura dos ombros (ou um pouco menos).",
                "Desça a barra controlado até tocar o meio do peito.",
                "Empurre a barra para cima estendendo os braços, focando no tríceps.",
                "Mantenha os cotovelos próximos ao corpo durante o movimento."
            ],
            mistakes: [
                "Mãos muito juntas (tensão excessiva nos pulsos).",
                "Cotovelos abrindo para os lados.",
                "Fazer rapidamente sem controle."
            ],
            tips: [
                "Permite cargas mais pesadas que exercícios isolados de tríceps.",
                "Cotovelos próximos ao corpo = maior ativação do tríceps.",
                "Excelente exercício composto para massa de tríceps."
            ]
        },

        // ─────────────────────────────────────────────────────────────
        //  GRUPO C — PEITO (Premium)
        // ─────────────────────────────────────────────────────────────

        {
            id: "C-01", pt: "Supino inclinado", en: "Incline Bench Press",
            nome: "Supino inclinado", group: "Peito", grupoMuscular: "Peito",
            muscles: ["Peitoral maior (porção clavicular)"], secondary: ["Deltóide anterior", "Tríceps"],
            gif: "assets/gifs/peito/supino-inclinado.gif",
            video: "https://www.youtube.com/results?search_query=incline+bench+press+leandro+twin",
            difficulty: "Intermediate", equipment: "Barra e banco inclinado", equipamento: "Barra e banco inclinado", tipo: "C",
            instructions: [
                "Ajuste o banco entre 30° e 45° de inclinação.",
                "Deite-se com os pés apoiados no chão e as escápulas retraídas.",
                "Segure a barra com pegada um pouco mais larga que os ombros.",
                "Desça a barra controlado até a altura do peito superior.",
                "Empurre a barra para cima até a extensão dos braços."
            ],
            mistakes: [
                "Inclinação muito alta (>45°) — sobrecarrega o ombro.",
                "Não retrair as escápulas (perde estabilidade).",
                "Quicar a barra no peito."
            ],
            tips: [
                "30-45° é o ângulo ideal para peito superior sem sobrecarregar o ombro.",
                "Use halteres para maior amplitude de movimento.",
                "Foque em empurrar com o peito, não com os braços."
            ]
        },

        {
            id: "C-02", pt: "Supino reto", en: "Flat Bench Press",
            nome: "Supino reto", group: "Peito", grupoMuscular: "Peito",
            muscles: ["Peitoral maior (porção esternal)"], secondary: ["Deltóide anterior", "Tríceps"],
            gif: "assets/gifs/peito/supino-reto.gif",
            video: "https://www.youtube.com/results?search_query=bench+press+leandro+twin",
            difficulty: "Intermediate", equipment: "Barra e banco reto", equipamento: "Barra e banco reto", tipo: "C",
            instructions: [
                "Deite-se no banco reto com os pés firmes no chão.",
                "Retraia e deprimia as escápulas, arqueando levemente as costas.",
                "Segure a barra com pegada um pouco mais larga que os ombros.",
                "Desça a barra até o meio do peito, tocando ou quase tocando.",
                "Empurre a barra para cima até a extensão quase completa dos braços."
            ],
            mistakes: [
                "Mãos muito afastadas (tensão no ombro).",
                "Bater a barra no peito.",
                "Levantar o quadril do banco.",
                "Não retrair as escápulas."
            ],
            tips: [
                "O rei dos exercícios de peito — permite as maiores cargas.",
                "Mantenha os pés firmes para estabilidade e força.",
                "Respire: inspire descendo, expire subindo."
            ]
        },

        {
            id: "C-03", pt: "Supino declinado", en: "Decline Bench Press",
            nome: "Supino declinado", group: "Peito", grupoMuscular: "Peito",
            muscles: ["Peitoral maior (porção inferior)"], secondary: ["Tríceps", "Deltóide anterior"],
            gif: "assets/gifs/peito/supino-declinado.gif",
            video: "https://www.youtube.com/results?search_query=decline+bench+press+leandro+twin",
            difficulty: "Intermediate", equipment: "Barra e banco declinado", equipamento: "Barra e banco declinado", tipo: "C",
            instructions: [
                "Ajuste o banco declinado e apoie os pés nos roletes de retenção.",
                "Deite-se com a cabeça abaixo do quadril.",
                "Segure a barra com pegada um pouco mais larga que os ombros.",
                "Desça a barra controlado até a parte inferior do peito.",
                "Empurre a barra para cima até a extensão dos braços."
            ],
            mistakes: [
                "Não usar os roletes de retenção (risco de escorregar).",
                "Fazer movimento parcial.",
                "Usar peso excessivo sem spotting."
            ],
            tips: [
                "Foco na porção inferior do peitoral — dá o contorno em V do peito.",
                "Ângulo ideal: -15° a -30°.",
                "Alternativa mais segura: supino reto com halteres descendo até a linha do peito."
            ]
        },

        {
            id: "C-04", pt: "Supino halter", en: "Dumbbell Bench Press",
            nome: "Supino halter", group: "Peito", grupoMuscular: "Peito",
            muscles: ["Peitoral maior"], secondary: ["Deltóide anterior", "Tríceps"],
            gif: "assets/gifs/peito/supino-halter.gif",
            video: "https://www.youtube.com/results?search_query=dumbbell+bench+press+leandro+twin",
            difficulty: "Intermediate", equipment: "Halteres e banco reto", equipamento: "Halteres e banco reto", tipo: "C",
            instructions: [
                "Sente-se no banco com os halteres apoiados nas coxas.",
                "Deite-se e empurre os halteres para cima, alinhados com o peito.",
                "Segure os halteres com pegada neutra levemente inclinada.",
                "Desça os halteres até sentir alongamento no peito.",
                "Empurre de volta até os halteres quase se tocarem no topo."
            ],
            mistakes: [
                "Bater os halteres no topo (perde tensão).",
                "Deixar os cotovelos abrirem demais.",
                "Usar halteres muito pesados sem controle."
            ],
            tips: [
                "Maior amplitude de movimento que o supino com barra.",
                "Corrige desequilíbrios entre os lados do corpo.",
                "Permite girar os pulsos para maior contração no topo."
            ]
        },

        {
            id: "C-05", pt: "Supino máquina", en: "Chest Press Machine",
            nome: "Supino máquina", group: "Peito", grupoMuscular: "Peito",
            muscles: ["Peitoral maior"], secondary: ["Deltóide anterior", "Tríceps"],
            gif: "assets/gifs/peito/supino-maquina.gif",
            video: "https://www.youtube.com/results?search_query=chest+press+machine+leandro+twin",
            difficulty: "Beginner", equipment: "Máquina chest press", equipamento: "Máquina chest press", tipo: "C",
            instructions: [
                "Ajuste o assento para que as pegadas fiquem na altura do peito.",
                "Sente-se com as costas apoiadas no encosto.",
                "Segure as pegadas com as mãos na largura dos ombros.",
                "Empurre as pegadas para frente até extensão quase completa.",
                "Retorne controlado até os cotovelos formarem 90°."
            ],
            mistakes: [
                "Empurrar até travar os cotovelos (tensão nas articulações).",
                "Levar as costas do encosto.",
                "Fazer rápido sem controle."
            ],
            tips: [
                "Ideal para iniciantes — movimento guiado e seguro.",
                "Excelente para treinos de drop set (fácil troca de carga).",
                "Mantenha a scápula retraída mesmo na máquina."
            ]
        },

        {
            id: "C-06", pt: "Cross over alta", en: "High Cable Crossover",
            nome: "Cross over alta", group: "Peito", grupoMuscular: "Peito",
            muscles: ["Peitoral maior (porção inferior)"], secondary: ["Deltóide anterior"],
            gif: "assets/gifs/peito/cross-over-alta.gif",
            video: "https://www.youtube.com/results?search_query=cable+crossover+high+leandro+twin",
            difficulty: "Intermediate", equipment: "Polia alta dupla", equipamento: "Polia alta dupla", tipo: "C",
            instructions: [
                "Fique no meio do cross, segurando uma pegada em cada polia alta.",
                "Dê um passo à frente para criar tensão nos cabos.",
                "Com leves flexões nos cotovelos, puxe as pegadas para baixo e frente.",
                "Cruze as mãos no ponto mais baixo, contraindo o peito.",
                "Retorne controlado até sentir alongamento no peito."
            ],
            mistakes: [
                "Usar peso que comprometa a forma.",
                "Mover os cotovelos demais (vira um pushdown).",
                "Não sentir o alongamento na fase excêntrica."
            ],
            tips: [
                "Inclinação alta foca na porção inferior do peitoral.",
                "Mantenha leves flexões nos cotovelos — nunca trave.",
                "Último exercício de peito — foche na contração e no pump."
            ]
        },

        {
            id: "C-07", pt: "Cross over média", en: "Mid Cable Crossover",
            nome: "Cross over média", group: "Peito", grupoMuscular: "Peito",
            muscles: ["Peitoral maior (porção esternal)"], secondary: ["Deltóide anterior"],
            gif: "assets/gifs/peito/cross-over-media.gif",
            video: "https://www.youtube.com/results?search_query=cable+crossover+mid+leandro+twin",
            difficulty: "Intermediate", equipment: "Polia média dupla", equipamento: "Polia média dupla", tipo: "C",
            instructions: [
                "Ajuste as polias na altura dos ombros.",
                "Fique no meio, segurando uma pegada em cada lado.",
                "Com um passo à frente, puxe as pegadas à frente do corpo.",
                "As mãos devem se encontrar na linha do peito.",
                "Retorne até sentirAlongamento amplo no peitoral."
            ],
            mistakes: [
                "Polias muito altas ou muito baixas.",
                "Trabalhar mais com os braços que com o peito.",
                "Fazer sem sentir o peito trabalhar."
            ],
            tips: [
                "Ajuste a altura das polias para atingir diferentes porções do peito.",
                "Foco na contração isométrica — segure 2 segundos no meio.",
                "Mantenha os ombros para baixo e os peitorais contraídos."
            ]
        },

        {
            id: "C-08", pt: "Cross over baixa", en: "Low Cable Crossover",
            nome: "Cross over baixa", group: "Peito", grupoMuscular: "Peito",
            muscles: ["Peitoral maior (porção clavicular)"], secondary: ["Deltóide anterior"],
            gif: "assets/gifs/peito/cross-over-baixa.gif",
            video: "https://www.youtube.com/results?search_query=cable+crossover+low+leandro+twin",
            difficulty: "Intermediate", equipment: "Polia baixa dupla", equipamento: "Polia baixa dupla", tipo: "C",
            instructions: [
                "Ajuste as polias na posição mais baixa.",
                "Fique no meio, segurando uma pegada em cada lado.",
                "Com leves flexões nos cotovelos, puxe as pegadas para cima e frente.",
                "As mãos devem se encontrar na altura dos ombros ou acima.",
                "Retorne controlado até sentirAlongamento no peitoral superior."
            ],
            mistakes: [
                "Puxar com os bíceps em vez do peito.",
                "Mãos muito afastadas no topo.",
                "Usar impulso do corpo."
            ],
            tips: [
                "Inclinação baixa foca na porção superior (clavicular) do peitoral.",
                "Excelente complemento ao supino inclinado.",
                "Mantenha o peito para cima durante todo o movimento."
            ]
        },

        {
            id: "C-09", pt: "Crucifixo halter", en: "Dumbbell Fly",
            nome: "Crucifixo halter", group: "Peito", grupoMuscular: "Peito",
            muscles: ["Peitoral maior"], secondary: ["Deltóide anterior"],
            gif: "assets/gifs/peito/crucifixo-halter.gif",
            video: "https://www.youtube.com/results?search_query=dumbbell+fly+leandro+twin",
            difficulty: "Intermediate", equipment: "Halteres e banco reto", equipamento: "Halteres e banco reto", tipo: "C",
            instructions: [
                "Deite-se no banco reto com um halter em cada mão, braços estendidos acima do peito.",
                "Com leves flexões nos cotovelos, abra os braços em arco até sentirAlongamento no peito.",
                "Retorne os halteres à posição inicial contraindo o peito.",
                "Os cotovelos devem manter o mesmo ângulo durante todo o movimento.",
                "Use um arco amplo, como se estivesse abraçando uma árvore."
            ],
            mistakes: [
                "Trabalhar os braços em vez do peito.",
                "Descer demais (tensão no ombro).",
                "Travar os cotovelos (vira supino)."
            ],
            tips: [
                "Isolamento puro do peitoral — sem tríceps.",
                "Foque noAlongamento (descida) e na contração (topo).",
                "Alternativa: crucifixo na máquina (mais seguro para iniciantes)."
            ]
        },

        {
            id: "C-10", pt: "Peck deck", en: "Pec Deck / Machine Fly",
            nome: "Peck deck", group: "Peito", grupoMuscular: "Peito",
            muscles: ["Peitoral maior"], secondary: ["Deltóide anterior"],
            gif: "assets/gifs/peito/peck-deck.gif",
            video: "https://www.youtube.com/results?search_query=pec+deck+leandro+twin",
            difficulty: "Beginner", equipment: "Máquina peck deck", equipamento: "Máquina peck deck", tipo: "C",
            instructions: [
                "Ajuste o assento para que os cotovelos fiquem na altura dos ombros.",
                "Sente-se com as costas apoiadas no encosto.",
                "Segure as pegadas ou apoie os antebraços nos apoios.",
                "Feche os braços à frente, contraindo o peito no ponto de encontro.",
                "Retorne lentamente até sentirAlongamento no peitoral."
            ],
            mistakes: [
                "Fechar os braços com impulso.",
                "Não controlar a abertura (fase excêntrica).",
                "Ajuste incorreto do assento."
            ],
            tips: [
                "Isolamento perfeito para o peitoral — sem estabilização necessária.",
                "Ideal para trabalhar com drop sets ou repetições até a falha.",
                "Variação: peck deck inverso para deltóide posterior."
            ]
        },

        // ─────────────────────────────────────────────────────────────
        //  GRUPOS D–I (Legacy — compatibilidade)
        // ─────────────────────────────────────────────────────────────

        { id: "D-01", pt: "Puxada aberta", nome: "Puxada aberta", group: "Costas", grupoMuscular: "Costas", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "D", en: null, instructions: null, mistakes: null, tips: null },
        { id: "D-02", pt: "Puxada fechada", nome: "Puxada fechada", group: "Costas", grupoMuscular: "Costas", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "D", en: null, instructions: null, mistakes: null, tips: null },
        { id: "D-03", pt: "Puxada pronada", nome: "Puxada pronada", group: "Costas", grupoMuscular: "Costas", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "D", en: null, instructions: null, mistakes: null, tips: null },
        { id: "D-04", pt: "Pulley articulado", nome: "Pulley articulado", group: "Costas", grupoMuscular: "Costas", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "D", en: null, instructions: null, mistakes: null, tips: null },
        { id: "D-05", pt: "Remada baixa", nome: "Remada baixa", group: "Costas", grupoMuscular: "Costas", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "D", en: null, instructions: null, mistakes: null, tips: null },
        { id: "D-06", pt: "Remada unilateral", nome: "Remada unilateral", group: "Costas", grupoMuscular: "Costas", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "D", en: null, instructions: null, mistakes: null, tips: null },
        { id: "D-07", pt: "Remada curvada", nome: "Remada curvada", group: "Costas", grupoMuscular: "Costas", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "D", en: null, instructions: null, mistakes: null, tips: null },
        { id: "D-08", pt: "Remada cavalinho", nome: "Remada cavalinho", group: "Costas", grupoMuscular: "Costas", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "D", en: null, instructions: null, mistakes: null, tips: null },
        { id: "D-09", pt: "Face pull", nome: "Face pull", group: "Costas", grupoMuscular: "Costas", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "D", en: null, instructions: null, mistakes: null, tips: null },
        { id: "D-10", pt: "Hiperextensão", nome: "Hiperextensão", group: "Costas", grupoMuscular: "Costas", subgrupo: "Lombar", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "D", en: null, instructions: null, mistakes: null, tips: null },

        { id: "E-01", pt: "Desenvolvimento halteres", nome: "Desenvolvimento halteres", group: "Ombro", grupoMuscular: "Ombro", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "E", en: null, instructions: null, mistakes: null, tips: null },
        { id: "E-02", pt: "Desenvolvimento máquina", nome: "Desenvolvimento máquina", group: "Ombro", grupoMuscular: "Ombro", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "E", en: null, instructions: null, mistakes: null, tips: null },
        { id: "E-03", pt: "Elevação lateral", nome: "Elevação lateral", group: "Ombro", grupoMuscular: "Ombro", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "E", en: null, instructions: null, mistakes: null, tips: null },
        { id: "E-04", pt: "Elevação lateral drop", nome: "Elevação lateral drop", group: "Ombro", grupoMuscular: "Ombro", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "E", en: null, instructions: null, mistakes: null, tips: null },
        { id: "E-05", pt: "Elevação frontal", nome: "Elevação frontal", group: "Ombro", grupoMuscular: "Ombro", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "E", en: null, instructions: null, mistakes: null, tips: null },
        { id: "E-06", pt: "Crucifixo inverso", nome: "Crucifixo inverso", group: "Ombro", grupoMuscular: "Ombro", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "E", en: null, instructions: null, mistakes: null, tips: null },
        { id: "E-07", pt: "Remada alta", nome: "Remada alta", group: "Ombro", grupoMuscular: "Ombro", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "E", en: null, instructions: null, mistakes: null, tips: null },
        { id: "E-08", pt: "Arnold press", nome: "Arnold press", group: "Ombro", grupoMuscular: "Ombro", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "E", en: null, instructions: null, mistakes: null, tips: null },
        { id: "E-09", pt: "Rotação externa", nome: "Rotação externa", group: "Ombro", grupoMuscular: "Ombro", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "E", en: null, instructions: null, mistakes: null, tips: null },

        { id: "F-01", pt: "Trapézio halter", nome: "Trapézio halter", group: "Trapézio", grupoMuscular: "Trapézio", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "F", en: null, instructions: null, mistakes: null, tips: null },
        { id: "F-02", pt: "Trapézio barra", nome: "Trapézio barra", group: "Trapézio", grupoMuscular: "Trapézio", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "F", en: null, instructions: null, mistakes: null, tips: null },
        { id: "F-03", pt: "Encolhimento máquina", nome: "Encolhimento máquina", group: "Trapézio", grupoMuscular: "Trapézio", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "F", en: null, instructions: null, mistakes: null, tips: null },
        { id: "F-04", pt: "Face pull", nome: "Face pull", group: "Trapézio", grupoMuscular: "Trapézio", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "F", en: null, instructions: null, mistakes: null, tips: null },
        { id: "F-05", pt: "Remada alta", nome: "Remada alta", group: "Trapézio", grupoMuscular: "Trapézio", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "F", en: null, instructions: null, mistakes: null, tips: null },

        { id: "G-01", pt: "Agachamento livre", nome: "Agachamento livre", group: "Pernas", grupoMuscular: "Pernas", subgrupo: "Quadríceps", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "G", en: null, instructions: null, mistakes: null, tips: null },
        { id: "G-02", pt: "Agachamento máquina", nome: "Agachamento máquina", group: "Pernas", grupoMuscular: "Pernas", subgrupo: "Quadríceps", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "G", en: null, instructions: null, mistakes: null, tips: null },
        { id: "G-03", pt: "Leg press", nome: "Leg press", group: "Pernas", grupoMuscular: "Pernas", subgrupo: "Quadríceps", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "G", en: null, instructions: null, mistakes: null, tips: null },
        { id: "G-04", pt: "Cadeira extensora", nome: "Cadeira extensora", group: "Pernas", grupoMuscular: "Pernas", subgrupo: "Quadríceps", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "G", en: null, instructions: null, mistakes: null, tips: null },
        { id: "G-05", pt: "Cadeira flexora", nome: "Cadeira flexora", group: "Pernas", grupoMuscular: "Pernas", subgrupo: "Posterior de Coxa", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "G", en: null, instructions: null, mistakes: null, tips: null },
        { id: "G-06", pt: "Mesa flexora", nome: "Mesa flexora", group: "Pernas", grupoMuscular: "Pernas", subgrupo: "Posterior de Coxa", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "G", en: null, instructions: null, mistakes: null, tips: null },
        { id: "G-07", pt: "Stiff", nome: "Stiff", group: "Pernas", grupoMuscular: "Pernas", subgrupo: "Posterior de Coxa", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "G", en: null, instructions: null, mistakes: null, tips: null },
        { id: "G-08", pt: "Avanço", nome: "Avanço", group: "Pernas", grupoMuscular: "Pernas", subgrupo: "Quadríceps", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "G", en: null, instructions: null, mistakes: null, tips: null },
        { id: "G-09", pt: "Afundo", nome: "Afundo", group: "Pernas", grupoMuscular: "Pernas", subgrupo: "Quadríceps", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "G", en: null, instructions: null, mistakes: null, tips: null },
        { id: "G-10", pt: "Panturrilha máquina", nome: "Panturrilha máquina", group: "Pernas", grupoMuscular: "Pernas", subgrupo: "Panturrilha", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "G", en: null, instructions: null, mistakes: null, tips: null },
        { id: "G-11", pt: "Panturrilha livre", nome: "Panturrilha livre", group: "Pernas", grupoMuscular: "Pernas", subgrupo: "Panturrilha", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "G", en: null, instructions: null, mistakes: null, tips: null },
        { id: "G-12", pt: "Hip thrust", nome: "Hip thrust", group: "Pernas", grupoMuscular: "Pernas", subgrupo: "Glúteo", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "G", en: null, instructions: null, mistakes: null, tips: null },

        { id: "H-01", pt: "Hip thrust", nome: "Hip thrust", group: "Glúteo", grupoMuscular: "Glúteo", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "H", en: null, instructions: null, mistakes: null, tips: null },
        { id: "H-02", pt: "Hip thrust máquina", nome: "Hip thrust máquina", group: "Glúteo", grupoMuscular: "Glúteo", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "H", en: null, instructions: null, mistakes: null, tips: null },
        { id: "H-03", pt: "Abdução máquina", nome: "Abdução máquina", group: "Glúteo", grupoMuscular: "Glúteo", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "H", en: null, instructions: null, mistakes: null, tips: null },
        { id: "H-04", pt: "Coice polia", nome: "Coice polia", group: "Glúteo", grupoMuscular: "Glúteo", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "H", en: null, instructions: null, mistakes: null, tips: null },
        { id: "H-05", pt: "Stiff", nome: "Stiff", group: "Glúteo", grupoMuscular: "Glúteo", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "H", en: null, instructions: null, mistakes: null, tips: null },
        { id: "H-06", pt: "Avanço", nome: "Avanço", group: "Glúteo", grupoMuscular: "Glúteo", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "H", en: null, instructions: null, mistakes: null, tips: null },
        { id: "H-07", pt: "Agachamento sumô", nome: "Agachamento sumô", group: "Glúteo", grupoMuscular: "Glúteo", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "H", en: null, instructions: null, mistakes: null, tips: null },

        { id: "I-01", pt: "Prancha", nome: "Prancha", group: "Abdômen", grupoMuscular: "Abdômen", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "I", en: null, instructions: null, mistakes: null, tips: null },
        { id: "I-02", pt: "Crunch máquina", nome: "Crunch máquina", group: "Abdômen", grupoMuscular: "Abdômen", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "I", en: null, instructions: null, mistakes: null, tips: null },
        { id: "I-03", pt: "Abdominal bicicleta", nome: "Abdominal bicicleta", group: "Abdômen", grupoMuscular: "Abdômen", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "I", en: null, instructions: null, mistakes: null, tips: null },
        { id: "I-04", pt: "Elevação de pernas", nome: "Elevação de pernas", group: "Abdômen", grupoMuscular: "Abdômen", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "I", en: null, instructions: null, mistakes: null, tips: null },
        { id: "I-05", pt: "Rotação russa", nome: "Rotação russa", group: "Abdômen", grupoMuscular: "Abdômen", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "I", en: null, instructions: null, mistakes: null, tips: null },
        { id: "I-06", pt: "Abdominal roda", nome: "Abdominal roda", group: "Abdômen", grupoMuscular: "Abdômen", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "I", en: null, instructions: null, mistakes: null, tips: null },
        { id: "I-07", pt: "Crunch oblíquo", nome: "Crunch oblíquo", group: "Abdômen", grupoMuscular: "Abdômen", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "I", en: null, instructions: null, mistakes: null, tips: null },
        { id: "I-08", pt: "Vacum", nome: "Vacum", group: "Abdômen", grupoMuscular: "Abdômen", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "I", en: null, instructions: null, mistakes: null, tips: null },
        { id: "I-09", pt: "Abdominal infra", nome: "Abdominal infra", group: "Abdômen", grupoMuscular: "Abdômen", muscles: null, secondary: null, gif: null, video: null, difficulty: null, equipment: null, equipamento: null, tipo: "I", en: null, instructions: null, mistakes: null, tips: null },

        { id: "J-01", pt: "Sustentação de carga (Farmer's Walk / Dead Hang)", nome: "Sustentação de carga (Farmer's Walk / Dead Hang)", en: "Static Hold", group: "Antebraço", grupoMuscular: "Antebraço", muscles: ["Antebraço"], secondary: ["Cardiorrespiratório"], gif: null, video: null, difficulty: "Beginner", equipment: "Halteres pesados / Barra fixa", equipamento: "Halteres pesados / Barra fixa", tipo: "J", instructions: null, mistakes: null, tips: null },
        { id: "J-02", pt: "Rosca de punho", nome: "Rosca de punho", en: "Wrist Curl", group: "Antebraço", grupoMuscular: "Antebraço", muscles: ["Antebraço"], secondary: null, gif: null, video: null, difficulty: "Beginner", equipment: "Barra reta ou halteres", equipamento: "Barra reta ou halteres", tipo: "J", instructions: null, mistakes: null, tips: null }

    ]

};

// ── Ponte de módulos (TreinoTracker DeepSeek) ─────────────────────────
// Carregado como <script> clássico, `ExerciseCatalog` vive no escopo léxico
// global (igual a `state`). Para os testes em Node, também exportamos.
if (typeof globalThis !== "undefined") globalThis.ExerciseCatalog = ExerciseCatalog;
if (typeof module !== "undefined" && module.exports) module.exports = ExerciseCatalog;
