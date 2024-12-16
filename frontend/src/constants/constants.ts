import { client } from "@/app/client";
import { getContract } from "thirdweb";
import { localhost } from "thirdweb/chains";
import { createWallet } from "thirdweb/wallets";

export const projectRegistryContractAddress =
  "0x162459Bb429a63D2e31Fe2d1cdb5b058f2D31AdF";
export const carbonTokenContractAddress = "0x0";
export const marketplaceContractAddress = "0x0";

export const wallets = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
  createWallet("io.rabby"),
  createWallet("io.zerion.wallet"),
];

export const baseChain = localhost;

export const projectRegistryContract = getContract({
  client: client,
  chain: baseChain,
  address: projectRegistryContractAddress,
});

export const carbonTokenContract = getContract({
  client: client,
  chain: baseChain,
  address: projectRegistryContractAddress,
});

export const marketplaceContract = getContract({
  client: client,
  chain: baseChain,
  address: projectRegistryContractAddress,
});
