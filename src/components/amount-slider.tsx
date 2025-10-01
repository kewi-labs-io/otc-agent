import Image from "next/image";
import { useState } from "react";

export default function AmountSlider() {
  return (
    <div className="px-4 py-2 rounded-md h-[140px] w-full bg-[#1D1D1D] border-[1px] border-white/10">
      <h1 className="text-white text-[14px] font-medium">Amount to Buy</h1>
      <div className="flex">
        <Slider balance={2500} />
      </div>
    </div>
  );
}

function Slider({ balance }: { balance: number }) {
  const [buyAmount, setBuyAmount] = useState<number>(0);
  return (
    <div className="w-full">
      <div className="flex flex-row">
        <h1 className="w-3/4 text-white font-bold text-[48px]">{buyAmount}</h1>
        <div className="flex items-center space-x-2 flex-row">
          <Image
            src="/tokens/eliza.svg"
            height={40}
            width={40}
            alt="eliza-token"
          />
          <h1 className="text-[24px] font-bold">$ELIZA</h1>
        </div>
      </div>
      <div className="flex items-center flex-row">
        <div className="w-3/4 items-center">
          <input
            type="range"
            min="0"
            max={balance}
            value={buyAmount}
            onChange={(e) => setBuyAmount(Number(e.target.value))}
            className="w-[95%] h-2 rounded-lg appearance-none cursor-pointer
             [&::-webkit-slider-thumb]:appearance-none
             [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
             [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#F75B1E]"
            style={{
              background: `linear-gradient(to right, #F75B1E 0%, #F75B1E ${(buyAmount / balance) * 100}%, rgba(255, 255, 255, 0.2) ${(buyAmount / balance) * 100}%, rgba(255, 255, 255, 0.2) 100%)`,
            }}
          />
        </div>
        <div className="flex items-center space-x-2 flex-row">
          <h1 className="text-[13px] text-[#A6A6A6] font-medium">
            Balance: {balance}
          </h1>
          <button
            onClick={() => setBuyAmount(balance)}
            className="bg-none text-[#F75B1E] text-[13px] uppercase font-bold"
          >
            max
          </button>
        </div>
      </div>
    </div>
  );
}
