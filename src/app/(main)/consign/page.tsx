"use client";

import { useState } from "react";
import dynamicImport from "next/dynamic";
import { Footer } from "@/components/footer";

const TokenSelectionStep = dynamicImport(
  () =>
    import("@/components/consignment-form/token-selection-step").then(
      (m) => m.TokenSelectionStep,
    ),
  { ssr: false },
);
const AmountStep = dynamicImport(
  () =>
    import("@/components/consignment-form/amount-step").then(
      (m) => m.AmountStep,
    ),
  { ssr: false },
);
const NegotiationParamsStep = dynamicImport(
  () =>
    import("@/components/consignment-form/negotiation-params-step").then(
      (m) => m.NegotiationParamsStep,
    ),
  { ssr: false },
);
const DealStructureStep = dynamicImport(
  () =>
    import("@/components/consignment-form/deal-structure-step").then(
      (m) => m.DealStructureStep,
    ),
  { ssr: false },
);
const ProtectionsStep = dynamicImport(
  () =>
    import("@/components/consignment-form/protections-step").then(
      (m) => m.ProtectionsStep,
    ),
  { ssr: false },
);
const ReviewStep = dynamicImport(
  () =>
    import("@/components/consignment-form/review-step").then(
      (m) => m.ReviewStep,
    ),
  { ssr: false },
);

export const dynamic = "force-dynamic";

export default function ConsignPage() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    tokenId: "",
    amount: "",
    isNegotiable: true,
    fixedDiscountBps: 1000,
    fixedLockupDays: 180,
    minDiscountBps: 500,
    maxDiscountBps: 2000,
    minLockupDays: 7,
    maxLockupDays: 365,
    minDealAmount: "",
    maxDealAmount: "",
    isFractionalized: true,
    isPrivate: false,
    allowedBuyers: [] as string[],
    maxPriceVolatilityBps: 1000,
    maxTimeToExecuteSeconds: 1800,
  });

  const updateFormData = (updates: Partial<typeof formData>) => {
    setFormData({ ...formData, ...updates });
  };

  const steps = [
    { number: 1, title: "Select Token", component: TokenSelectionStep },
    { number: 2, title: "Amount", component: AmountStep },
    { number: 3, title: "Terms", component: NegotiationParamsStep },
    { number: 4, title: "Structure", component: DealStructureStep },
    { number: 5, title: "Protections", component: ProtectionsStep },
    { number: 6, title: "Review", component: ReviewStep },
  ];

  const CurrentStepComponent = steps[step - 1].component;

  return (
    <>
      <main className="flex-1 px-4 sm:px-6 py-8">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl font-bold mb-2">List Your Tokens for OTC</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mb-8">
            Create a consignment to offer your tokens at discounted rates
          </p>

          <div className="flex items-center justify-between mb-8">
            {steps.map((s) => (
              <div
                key={s.number}
                className={`flex items-center ${
                  s.number < steps.length ? "flex-1" : ""
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                    step === s.number
                      ? "bg-emerald-600 text-white"
                      : step > s.number
                        ? "bg-emerald-600/20 text-emerald-600"
                        : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600"
                  }`}
                >
                  {s.number}
                </div>
                {s.number < steps.length && (
                  <div
                    className={`flex-1 h-1 mx-2 ${
                      step > s.number
                        ? "bg-emerald-600"
                        : "bg-zinc-200 dark:bg-zinc-800"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-8">
            <h2 className="text-xl font-semibold mb-6">
              {steps[step - 1].title}
            </h2>
            <CurrentStepComponent
              formData={formData}
              updateFormData={updateFormData}
              onNext={() => setStep(step + 1)}
              onBack={() => setStep(step - 1)}
            />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
