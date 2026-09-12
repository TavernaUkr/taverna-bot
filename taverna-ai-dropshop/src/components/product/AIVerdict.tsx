import { Sparkles, Target, Zap, Shirt } from "lucide-react";
import { useMemo } from "react";

interface AIVerdictProps {
  aiDescription: string;
  productName: string;
}

interface VerdictPoint {
  icon: React.ReactNode;
  title: string;
  text: string;
}

/**
 * Parses AI description and extracts 3 key selling points
 */
const extractVerdictPoints = (description: string, productName: string): VerdictPoint[] => {
  const points: VerdictPoint[] = [];
  
  // Clean and normalize text
  const text = description.toLowerCase();
  
  // 1. "Чому варто купити" - look for benefits, quality mentions
  const buyReasons = [];
  if (text.includes("якісн") || text.includes("quality")) buyReasons.push("висока якість");
  if (text.includes("міцн") || text.includes("надійн")) buyReasons.push("міцність та надійність");
  if (text.includes("комфорт") || text.includes("зручн")) buyReasons.push("комфорт у використанні");
  if (text.includes("практичн")) buyReasons.push("практичність");
  if (text.includes("стильн") || text.includes("модн")) buyReasons.push("стильний дизайн");
  if (text.includes("універсальн")) buyReasons.push("універсальність");
  
  const buyReason = buyReasons.length > 0 
    ? buyReasons.slice(0, 2).join(" та ") 
    : "відмінне співвідношення ціна/якість";
  
  points.push({
    icon: <Sparkles className="h-4 w-4 text-warning" />,
    title: "Чому варто купити",
    text: buyReason.charAt(0).toUpperCase() + buyReason.slice(1)
  });
  
  // 2. "Найкраще підходить для..." - look for use cases
  const useCases = [];
  if (text.includes("воєнн") || text.includes("військов") || text.includes("тактичн") || text.includes("бойов")) {
    useCases.push("військових та тактичних завдань");
  }
  if (text.includes("похід") || text.includes("турист") || text.includes("outdoor")) {
    useCases.push("туризму та активного відпочинку");
  }
  if (text.includes("щоден") || text.includes("повсякден")) {
    useCases.push("щоденного носіння");
  }
  if (text.includes("спорт") || text.includes("тренуван")) {
    useCases.push("спорту та тренувань");
  }
  if (text.includes("робот") || text.includes("професій")) {
    useCases.push("професійного використання");
  }
  if (text.includes("зим") || text.includes("холод") || text.includes("тепл")) {
    useCases.push("холодної погоди");
  }
  if (text.includes("літ") || text.includes("спек") || text.includes("легк")) {
    useCases.push("теплої погоди");
  }
  
  const useCase = useCases.length > 0 
    ? useCases[0] 
    : "активного способу життя";
  
  points.push({
    icon: <Target className="h-4 w-4 text-primary" />,
    title: "Найкраще підходить для",
    text: useCase.charAt(0).toUpperCase() + useCase.slice(1)
  });
  
  // 3. "Особливість" - look for material or special features
  const features = [];
  if (text.includes("бавовн")) features.push("натуральна бавовна");
  if (text.includes("cordura") || text.includes("кордура")) features.push("тканина Cordura");
  if (text.includes("gore-tex") || text.includes("мембран")) features.push("водонепроникна мембрана");
  if (text.includes("шкір") || text.includes("leather")) features.push("натуральна шкіра");
  if (text.includes("нейлон") || text.includes("nylon")) features.push("міцний нейлон");
  if (text.includes("поліестер")) features.push("стійкий поліестер");
  if (text.includes("rip-stop") || text.includes("ріпстоп")) features.push("тканина Rip-Stop");
  if (text.includes("флі") || text.includes("fleece")) features.push("флісова підкладка");
  if (text.includes("водовідштовх") || text.includes("водонепрон")) features.push("захист від вологи");
  if (text.includes("антибактер")) features.push("антибактеріальне покриття");
  
  const feature = features.length > 0 
    ? features[0] 
    : "продумана конструкція";
  
  points.push({
    icon: <Shirt className="h-4 w-4 text-accent-foreground" />,
    title: "Особливість",
    text: feature.charAt(0).toUpperCase() + feature.slice(1)
  });
  
  return points;
};

export const AIVerdict = ({ aiDescription, productName }: AIVerdictProps) => {
  const verdictPoints = useMemo(
    () => extractVerdictPoints(aiDescription, productName),
    [aiDescription, productName]
  );

  return (
    <div className="bg-gradient-to-br from-primary/10 via-accent/5 to-warning/10 rounded-2xl p-4 border border-primary/20">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 bg-primary/20 rounded-lg">
          <Zap className="h-4 w-4 text-primary" />
        </div>
        <h3 className="font-semibold text-sm text-foreground">AI-вердикт</h3>
        <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          Gemini
        </span>
      </div>
      
      <div className="space-y-2.5">
        {verdictPoints.map((point, idx) => (
          <div key={idx} className="flex items-start gap-2.5">
            <div className="mt-0.5 shrink-0">
              {point.icon}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-medium text-muted-foreground">
                {point.title}:
              </span>
              <span className="text-sm text-foreground ml-1">
                {point.text}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
