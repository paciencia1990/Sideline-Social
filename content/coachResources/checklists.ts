import type { CoachChecklist } from "@/types/coachResources";

const text = (en: string, es: string) => ({ en, es });
const item = (id: string, en: string, es: string) => ({ id, label: text(en, es) });

export const COACH_CHECKLISTS: CoachChecklist[] = [
  {
    id: "first-time-setup", category: "prepare", title: text("First-Time Coach Setup", "Preparación para tu Primera Temporada"),
    description: text("Build a confident foundation before meeting the team.", "Crea una base sólida antes de conocer al equipo."),
    contentVersion: 1, isActive: true, sortOrder: 10, recurringType: "one_time",
    sections: [{ id: "foundation", title: text("Build Your Foundation", "Crea tu Base"), items: [
      item("rules", "Review league rules and age-group expectations", "Revisa las reglas de la liga y las expectativas del grupo de edad"),
      item("requirements", "Confirm required certifications or background checks", "Confirma certificaciones o verificaciones de antecedentes requeridas"),
      item("contact", "Identify the primary league contact", "Identifica el contacto principal de la liga"),
      item("locations", "Confirm practice and game locations", "Confirma los lugares de prácticas y juegos"),
      item("emergency", "Review emergency and weather procedures", "Revisa los procedimientos de emergencia y clima"),
      item("equipment", "Check equipment availability", "Verifica la disponibilidad del equipo deportivo"),
      item("introduce", "Introduce yourself to families", "Preséntate con las familias"),
      item("communication", "Establish communication expectations", "Establece expectativas de comunicación"),
      item("volunteers", "Identify assistant coaches or volunteers", "Identifica coaches asistentes o voluntarios"),
      item("first-plan", "Prepare a simple first-practice plan", "Prepara un plan sencillo para la primera práctica"),
    ] }],
  },
  {
    id: "before-season", category: "prepare", title: text("Before the Season", "Antes de la Temporada"),
    description: text("Organize the essentials before the schedule begins.", "Organiza lo esencial antes de que comience el calendario."),
    contentVersion: 1, isActive: true, sortOrder: 20, recurringType: "one_time",
    sections: [{ id: "season-ready", title: text("Get Season Ready", "Prepárate para la Temporada"), items: [
      item("roster", "Confirm the roster and approved family contact process", "Confirma el roster y el proceso aprobado para contactar a las familias"),
      item("schedule", "Review the full season schedule", "Revisa el calendario completo de la temporada"),
      item("inventory", "Inspect and inventory equipment", "Inspecciona y registra el equipo deportivo"),
      item("facility", "Learn field or facility procedures", "Conoce los procedimientos del campo o instalación"),
      item("medical-process", "Confirm medical and emergency information is handled through approved league processes", "Confirma que la información médica y de emergencia se maneje mediante procesos aprobados por la liga"),
      item("expectations", "Prepare clear team expectations", "Prepara expectativas claras para el equipo"),
      item("practice-plans", "Plan the first two practices", "Planifica las primeras dos prácticas"),
      item("welcome", "Send a welcome communication", "Envía un mensaje de bienvenida"),
      item("volunteer-needs", "Identify volunteer needs", "Identifica las necesidades de voluntarios"),
      item("inclusion", "Review inclusion and accessibility needs without recording private child information", "Revisa necesidades de inclusión y accesibilidad sin registrar información privada de menores"),
    ] }],
  },
  {
    id: "practice-day", category: "coaching_days", title: text("Practice Day", "Día de Práctica"),
    description: text("Keep practice safe, active, and encouraging.", "Mantén la práctica segura, activa y positiva."),
    contentVersion: 1, isActive: true, sortOrder: 30, recurringType: "manual_reset",
    sections: [
      { id: "before-arrival", title: text("Before Players Arrive", "Antes de que Lleguen los Jugadores"), items: [
        item("goal", "Review today's practice goal", "Revisa la meta de la práctica de hoy"), item("space", "Inspect the playing space", "Inspecciona el área de juego"),
        item("first-aid", "Confirm first-aid supplies are available", "Confirma que haya suministros de primeros auxilios"), item("setup", "Set up equipment", "Prepara el equipo deportivo"),
        item("backup", "Prepare a backup activity", "Prepara una actividad alternativa"),
      ] },
      { id: "during", title: text("During Practice", "Durante la Práctica"), items: [
        item("focus", "Explain the day's focus in one clear instruction", "Explica el enfoque del día con una instrucción clara"), item("water", "Include water breaks", "Incluye descansos para tomar agua"),
        item("waiting", "Keep waiting time low and players involved", "Reduce el tiempo de espera y mantén a los jugadores activos"),
      ] },
      { id: "leaving", title: text("Before Everyone Leaves", "Antes de que Todos se Vayan"), items: [
        item("encouragement", "End with specific encouragement", "Termina con un mensaje positivo y específico"),
        item("account", "Account for every player before leaving", "Confirma que cada jugador esté con su adulto responsable antes de irte"),
      ] },
    ],
  },
  {
    id: "game-day", category: "coaching_days", title: text("Game Day", "Día de Juego"),
    description: text("Prepare the team and lead the day with calm.", "Prepara al equipo y lidera el día con calma."),
    contentVersion: 1, isActive: true, sortOrder: 40, recurringType: "manual_reset",
    sections: [
      { id: "before-leaving", title: text("Before Leaving", "Antes de Salir"), items: [
        item("confirm", "Confirm time, venue, and weather", "Confirma la hora, el lugar y el clima"), item("bring", "Bring required equipment", "Lleva el equipo deportivo requerido"),
        item("participation", "Review substitutions or the participation plan", "Revisa las sustituciones o el plan de participación"),
      ] },
      { id: "before-game", title: text("Before the Game", "Antes del Juego"), items: [
        item("arrive", "Arrive with enough setup time", "Llega con suficiente tiempo para preparar todo"), item("greet", "Greet players and families", "Saluda a los jugadores y las familias"),
        item("sportsmanship", "Reinforce sportsmanship and one team focus", "Refuerza la deportividad y un enfoque del equipo"),
      ] },
      { id: "during-game", title: text("During the Game", "Durante el Juego"), items: [
        item("appropriate", "Keep communication positive and age-appropriate", "Mantén una comunicación positiva y apropiada para la edad"), item("thanks", "Thank officials and volunteers", "Agradece a los oficiales y voluntarios"),
      ] },
      { id: "after-game", title: text("After the Game", "Después del Juego"), items: [
        item("pickup", "Confirm player pickup", "Confirma que cada jugador esté con su adulto responsable"), item("reminder", "Send or schedule the next reminder", "Envía o programa el próximo recordatorio"),
      ] },
    ],
  },
  {
    id: "player-safety", category: "safety_wrap_up", title: text("Player Safety", "Seguridad de los Jugadores"),
    description: text("Prepare for safe activities and approved responses.", "Prepárate para actividades seguras y respuestas aprobadas."),
    contentVersion: 1, isActive: true, sortOrder: 50, recurringType: "one_time",
    safetyNote: text("This checklist does not replace league policy, emergency services, or qualified medical guidance.", "Esta lista no reemplaza las políticas de la liga, los servicios de emergencia ni la orientación médica calificada."),
    sections: [{ id: "safety-preparation", title: text("Safety Preparation", "Preparación de Seguridad"), items: [
      item("inspect-space", "Inspect the field, court, or playing area", "Inspecciona el campo, la cancha o el área de juego"), item("condition", "Check equipment condition", "Revisa la condición del equipo deportivo"),
      item("league-process", "Know the league emergency process", "Conoce el proceso de emergencia de la liga"), item("contacts", "Keep emergency contacts accessible through approved systems", "Mantén los contactos de emergencia accesibles mediante sistemas aprobados"),
      item("hydration", "Confirm hydration breaks", "Confirma descansos para hidratación"), item("weather", "Monitor league weather and heat guidance", "Monitorea las guías de la liga sobre clima y calor"),
      item("stop", "Stop activity when the environment is unsafe", "Detén la actividad cuando el entorno no sea seguro"), item("injury", "Follow league concussion and injury procedures", "Sigue los procedimientos de la liga para conmociones y lesiones"),
      item("no-diagnosis", "Do not diagnose or provide medical advice", "No diagnostiques ni brindes consejos médicos"), item("report", "Document and report concerns through the approved league process", "Documenta e informa inquietudes mediante el proceso aprobado por la liga"),
    ] }],
  },
  {
    id: "end-season", category: "safety_wrap_up", title: text("End of Season", "Fin de Temporada"),
    description: text("Close the season thoughtfully and prepare for next time.", "Cierra la temporada con intención y prepárate para la próxima."),
    contentVersion: 1, isActive: true, sortOrder: 60, recurringType: "one_time",
    sections: [{ id: "wrap-up", title: text("Wrap Up Well", "Cierra Bien la Temporada"), items: [
      item("final-schedule", "Confirm the final schedule and remaining obligations", "Confirma el calendario final y las obligaciones pendientes"), item("return", "Return league or shared equipment", "Devuelve el equipo de la liga o compartido"),
      item("thank", "Thank volunteers", "Agradece a los voluntarios"), item("growth", "Recognize player growth and effort", "Reconoce el crecimiento y esfuerzo de los jugadores"),
      item("family-message", "Send an end-of-season family message", "Envía un mensaje de fin de temporada a las familias"), item("feedback", "Collect non-sensitive feedback", "Recopila comentarios no sensibles"),
      item("lessons", "Record lessons for next season", "Registra aprendizajes para la próxima temporada"), item("archive", "Close or archive recurring team tasks", "Cierra o archiva tareas recurrentes del equipo"),
      item("celebration", "Confirm awards or celebration details", "Confirma detalles de premios o celebración"), item("contact-point", "Leave families with the next approved contact point", "Deja a las familias el próximo contacto aprobado"),
    ] }],
  },
];
