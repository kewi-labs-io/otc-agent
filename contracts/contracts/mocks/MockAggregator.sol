// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockAggregatorV3 {
  int256 private _answer;
  uint8 private _decimals;

  constructor(uint8 decimals_, int256 initialAnswer) {
    _decimals = decimals_;
    _answer = initialAnswer;
  }

  function setAnswer(int256 a) external { _answer = a; }

  function latestRoundData() external view returns (
    uint80 roundId,
    int256 answer,
    uint256 startedAt,
    uint256 updatedAt,
    uint80 answeredInRound
  ) {
    return (0, _answer, block.timestamp, block.timestamp, 0);
  }

  function decimals() external view returns (uint8) { return _decimals; }
}




