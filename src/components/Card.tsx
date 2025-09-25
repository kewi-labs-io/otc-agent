import { ArrowRight } from "lucide-react";

export default function Card({ number, title, description, button }) {
  return (
    <div className="backdrop-blur-2xl bg-white/5 p-6 rounded-lg border border-[#FFB79B]">
      <div className="flex items-start gap-4 mb-4">
        <div className="text-orange-500 text-2xl font-bold">{number}</div>
        <div>
          <h3 className="text-white text-xl font-bold">{title}</h3>
          <p className="text-gray-400 max-w-md text-xs mt-1">{description}</p>
        </div>
      </div>
      <button className="cursor-pointer w-full bg-orange-500/10 text-orange-500 py-3 px-4 rounded-lg flex items-center justify-center gap-2 text-sm font-medium hover:bg-orange-500/20 transition-colors">
        {button}
        <ArrowRight size={14} />
      </button>
    </div>
  );
}
