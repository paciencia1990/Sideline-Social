import type { BombLocalizedText } from './bombDefusalTypes';

export type BombDifficulty = 'easy' | 'medium';

export type BombWordConcept = {
  id: string;
  answer: BombLocalizedText;
  scramble: BombLocalizedText;
  controlLabel: BombLocalizedText;
  difficulty: BombDifficulty;
  cipherApproved: boolean;
  validation: { independentlyReviewedLocales: readonly ['en', 'es']; familiarObject: true };
};

export type BombRiddleConcept = {
  id: string;
  answerConceptId: string;
  prompt: BombLocalizedText;
  explanation: BombLocalizedText;
  distractorConceptIds: readonly [string, string, string];
  difficulty: BombDifficulty;
  source: 'original-sideline-social';
};

export const bombText = (en: string, es: string): BombLocalizedText => ({ en, es });

const word = (
  id: string,
  en: string,
  enScramble: string,
  enLabel: string,
  es: string,
  esScramble: string,
  esLabel: string,
  difficulty: BombDifficulty = 'easy',
): BombWordConcept => ({
  id,
  answer: bombText(en, es),
  scramble: bombText(enScramble, esScramble),
  controlLabel: bombText(enLabel, esLabel),
  difficulty,
  // Cipher entries deliberately use only A-Z spellings. Spanish display labels
  // may retain accents, but words containing Ñ are excluded instead of being
  // silently converted to N by the supported Caesar alphabet.
  cipherApproved: /^[A-Z]+$/.test(en) && /^[A-Z]+$/.test(es) && !es.includes('Ñ'),
  validation: { independentlyReviewedLocales: ['en', 'es'], familiarObject: true },
});

export const BOMB_WORD_CONCEPTS: readonly BombWordConcept[] = [
  word('clock', 'CLOCK', 'KCOLC', 'Clock', 'RELOJ', 'JROLE', 'Reloj'),
  word('ball', 'BALL', 'LLAB', 'Ball', 'PELOTA', 'TALPEO', 'Pelota'),
  word('shoe', 'SHOE', 'OEHS', 'Shoe', 'ZAPATO', 'TOAZPA', 'Zapato'),
  word('star', 'STAR', 'RATS', 'Star', 'ESTRELLA', 'LLAERETS', 'Estrella'),
  word('moon', 'MOON', 'OOMN', 'Moon', 'LUNA', 'NALU', 'Luna'),
  word('book', 'BOOK', 'KOOB', 'Book', 'LIBRO', 'ROBIL', 'Libro'),
  word('apple', 'APPLE', 'PPAEL', 'Apple', 'MANZANA', 'NAZANAM', 'Manzana'),
  word('chair', 'CHAIR', 'RIHAC', 'Chair', 'SILLA', 'LLSIA', 'Silla'),
  word('table', 'TABLE', 'BLEAT', 'Table', 'MESA', 'SEAM', 'Mesa'),
  word('key', 'KEY', 'YEK', 'Key', 'LLAVE', 'VLELA', 'Llave'),
  word('door', 'DOOR', 'OODR', 'Door', 'PUERTA', 'TRAUPE', 'Puerta'),
  word('train', 'TRAIN', 'NIRAT', 'Train', 'TREN', 'NRTE', 'Tren'),
  word('plane', 'PLANE', 'AENLP', 'Plane', 'AVION', 'NOVIA', 'Avión'),
  word('boat', 'BOAT', 'TAOB', 'Boat', 'BARCO', 'COBRA', 'Barco'),
  word('tree', 'TREE', 'EERT', 'Tree', 'ARBOL', 'LABOR', 'Árbol'),
  word('flower', 'FLOWER', 'WERFLO', 'Flower', 'FLOR', 'RLOF', 'Flor', 'medium'),
  word('sun', 'SUN', 'UNS', 'Sun', 'SOL', 'LSO', 'Sol'),
  word('drum', 'DRUM', 'MRUD', 'Drum', 'TAMBOR', 'ROMBAT', 'Tambor'),
  word('whistle', 'WHISTLE', 'TLEWHIS', 'Whistle', 'SILBATO', 'OTABILS', 'Silbato', 'medium'),
  word('towel', 'TOWEL', 'LWEOT', 'Towel', 'TOALLA', 'LALTOA', 'Toalla'),
  word('pencil', 'PENCIL', 'CLENIP', 'Pencil', 'LAPIZ', 'ZILAP', 'Lápiz', 'medium'),
  word('cup', 'CUP', 'PUC', 'Cup', 'TAZA', 'ZATA', 'Taza'),
  word('helmet', 'HELMET', 'TLEMEH', 'Helmet', 'CASCO', 'SOCAC', 'Casco', 'medium'),
  word('compass', 'COMPASS', 'SSPOMAC', 'Compass', 'BRUJULA', 'ALUJURB', 'Brújula', 'medium'),
  word('stadium', 'STADIUM', 'MUIDTAS', 'Stadium', 'ESTADIO', 'OIDATSE', 'Estadio', 'medium'),
  word('backpack', 'BACKPACK', 'KCAPKCAB', 'Backpack', 'MOCHILA', 'ALIHCOM', 'Mochila', 'medium'),
  word('practice', 'PRACTICE', 'CIPTERAC', 'Practice', 'PRACTICA', 'CIPTARAC', 'Práctica', 'medium'),
] as const;

const riddle = (
  id: string,
  answerConceptId: string,
  enPrompt: string,
  esPrompt: string,
  enExplanation: string,
  esExplanation: string,
  distractorConceptIds: readonly [string, string, string],
  difficulty: BombDifficulty = 'easy',
): BombRiddleConcept => ({
  id,
  answerConceptId,
  prompt: bombText(enPrompt, esPrompt),
  explanation: bombText(enExplanation, esExplanation),
  distractorConceptIds,
  difficulty,
  source: 'original-sideline-social',
});

export const BOMB_RIDDLE_CONCEPTS: readonly BombRiddleConcept[] = [
  riddle('shows-time', 'clock', 'I have a face and hands that show the time. What am I?', 'Tengo una cara y manecillas que muestran la hora. ¿Qué soy?', 'A clock has a face and hands for showing time.', 'Un reloj tiene una cara y manecillas para mostrar la hora.', ['ball', 'book', 'shoe']),
  riddle('rolls-bounces', 'ball', 'I can roll and bounce, but I have no feet. What am I?', 'Puedo rodar y rebotar, pero no tengo pies. ¿Qué soy?', 'A ball rolls and bounces without feet.', 'Una pelota rueda y rebota sin tener pies.', ['clock', 'apple', 'cup']),
  riddle('worn-on-foot', 'shoe', 'I travel wherever you walk and protect your foot. What am I?', 'Voy contigo cuando caminas y protejo tu pie. ¿Qué soy?', 'A shoe protects a foot while you walk.', 'Un zapato protege el pie cuando caminas.', ['book', 'chair', 'towel']),
  riddle('night-sparkle', 'star', 'I look like a tiny light in the night sky. What am I?', 'Parezco una luz pequeña en el cielo nocturno. ¿Qué soy?', 'A star appears as a small light in the night sky.', 'Una estrella parece una luz pequeña en el cielo nocturno.', ['sun', 'moon', 'whistle']),
  riddle('night-orbit', 'moon', 'I travel around Earth and brighten many nights. What am I?', 'Viajo alrededor de la Tierra e ilumino muchas noches. ¿Qué soy?', 'The moon orbits Earth and reflects light at night.', 'La Luna gira alrededor de la Tierra y refleja luz por la noche.', ['star', 'sun', 'plane']),
  riddle('pages-stories', 'book', 'I have pages and can tell a story without speaking. What am I?', 'Tengo páginas y puedo contar una historia sin hablar. ¿Qué soy?', 'A book tells stories through its pages.', 'Un libro cuenta historias por medio de sus páginas.', ['clock', 'door', 'drum']),
  riddle('crunchy-fruit', 'apple', 'I am a round, crunchy fruit that grows on a tree. What am I?', 'Soy una fruta redonda y crujiente que crece en un árbol. ¿Qué soy?', 'An apple is a crunchy fruit that grows on a tree.', 'Una manzana es una fruta crujiente que crece en un árbol.', ['ball', 'cup', 'flower']),
  riddle('seat-with-legs', 'chair', 'I have legs, stay still, and give you a place to sit. What am I?', 'Tengo patas, permanezco quieta y te doy un lugar para sentarte. ¿Qué soy?', 'A chair has legs and provides a seat.', 'Una silla tiene patas y ofrece un lugar para sentarse.', ['table', 'shoe', 'boat']),
  riddle('flat-holder', 'table', 'I have a flat top and hold things above the floor. What am I?', 'Tengo una superficie plana y sostengo cosas sobre el piso. ¿Qué soy?', 'A table has a flat top that holds objects.', 'Una mesa tiene una superficie plana que sostiene objetos.', ['chair', 'book', 'door']),
  riddle('opens-lock', 'key', 'I am small, fit in a lock, and can open a door. What am I?', 'Soy pequeña, entro en una cerradura y puedo abrir una puerta. ¿Qué soy?', 'A key fits a lock to open it.', 'Una llave entra en una cerradura para abrirla.', ['pencil', 'whistle', 'spoon']),
  riddle('entry-panel', 'door', 'I swing or slide to let you enter a room. What am I?', 'Me abro o me deslizo para dejarte entrar a una habitación. ¿Qué soy?', 'A door opens to provide an entrance.', 'Una puerta se abre para permitir la entrada.', ['table', 'book', 'train']),
  riddle('runs-on-rails', 'train', 'I carry people and travel on rails. What am I?', 'Transporto personas y viajo sobre rieles. ¿Qué soy?', 'A train travels along rails.', 'Un tren viaja sobre rieles.', ['plane', 'boat', 'chair']),
  riddle('wings-no-feathers', 'plane', 'I have wings but no feathers and carry people through the sky. What am I?', 'Tengo alas, pero no plumas, y llevo personas por el cielo. ¿Qué soy?', 'A plane uses wings to fly without feathers.', 'Un avión usa alas para volar sin tener plumas.', ['bird', 'train', 'boat'], 'medium'),
  riddle('floats-carries', 'boat', 'I float on water and can carry people. What am I?', 'Floto en el agua y puedo transportar personas. ¿Qué soy?', 'A boat floats and carries people across water.', 'Un barco flota y transporta personas por el agua.', ['train', 'plane', 'cup']),
  riddle('roots-and-leaves', 'tree', 'I have roots, a trunk, and leaves, but I stay in one place. What am I?', 'Tengo raíces, tronco y hojas, pero permanezco en un lugar. ¿Qué soy?', 'A tree has roots, a trunk, and leaves.', 'Un árbol tiene raíces, tronco y hojas.', ['flower', 'pencil', 'door']),
  riddle('petals-bloom', 'flower', 'I grow from the ground and open colorful petals. What am I?', 'Crezco desde la tierra y abro pétalos de colores. ¿Qué soy?', 'A flower blooms with petals.', 'Una flor abre sus pétalos al florecer.', ['tree', 'star', 'apple']),
  riddle('warms-day', 'sun', 'I light and warm the daytime sky. What am I?', 'Ilumino y caliento el cielo durante el día. ¿Qué soy?', 'The sun provides daylight and warmth.', 'El Sol proporciona luz y calor durante el día.', ['moon', 'star', 'lamp']),
  riddle('rhythm-when-hit', 'drum', 'You tap or hit me to make a rhythm. What am I?', 'Me golpeas suavemente o con fuerza para crear un ritmo. ¿Qué soy?', 'A drum makes rhythmic sounds when struck.', 'Un tambor produce sonidos rítmicos al golpearlo.', ['whistle', 'book', 'cup']),
  riddle('sound-when-blown', 'whistle', 'Blow through me and I make a clear, sharp sound. What am I?', 'Sopla a través de mí y produciré un sonido claro y agudo. ¿Qué soy?', 'A whistle makes a sharp sound when air passes through it.', 'Un silbato produce un sonido agudo cuando el aire pasa por él.', ['drum', 'key', 'towel']),
  riddle('wetter-while-drying', 'towel', 'I become wetter while I dry something else. What am I?', 'Me mojo mientras seco otra cosa. ¿Qué soy?', 'A towel absorbs water while drying something.', 'Una toalla absorbe agua mientras seca algo.', ['cup', 'shoe', 'book']),
  riddle('shorter-while-writing', 'pencil', 'I become shorter the more you write with me. What am I?', 'Me hago más corto cuanto más escribes conmigo. ¿Qué soy?', 'A pencil becomes shorter as it is used and sharpened.', 'Un lápiz se hace más corto al usarlo y sacarle punta.', ['key', 'book', 'whistle'], 'medium'),
  riddle('holds-a-drink', 'cup', 'I can hold a drink even though I have no hands. What am I?', 'Puedo contener una bebida aunque no tengo manos. ¿Qué soy?', 'A cup holds a drink.', 'Una taza contiene una bebida.', ['towel', 'apple', 'ball']),
] as const;

// A few riddle distractors are familiar controls that are intentionally not
// word-scramble answers. They remain bilingual and can never be the solution.
export const BOMB_EXTRA_CONTROL_LABELS = {
  spoon: bombText('Spoon', 'Cuchara'),
  bird: bombText('Bird', 'Pájaro'),
  lamp: bombText('Lamp', 'Lámpara'),
} as const;

export function bombWordConceptById(conceptId: string) {
  return BOMB_WORD_CONCEPTS.find((entry) => entry.id === conceptId) ?? null;
}

export function bombControlLabel(conceptId: string): BombLocalizedText | null {
  const wordConcept = bombWordConceptById(conceptId);
  if (wordConcept) return wordConcept.controlLabel;
  return BOMB_EXTRA_CONTROL_LABELS[conceptId as keyof typeof BOMB_EXTRA_CONTROL_LABELS] ?? null;
}
